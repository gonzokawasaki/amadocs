const { v4: uuidv4 } = require("uuid");
const { DocumentManager } = require("../DocumentManager");
const { WorkspaceChats } = require("../../models/workspaceChats");
const { WorkspaceParsedFiles } = require("../../models/workspaceParsedFiles");
const { getVectorDbClass, resolveProviderConnector } = require("../helpers");
const { writeResponseChunk } = require("../helpers/chat/responses");
const { grepAgents } = require("./agents");
const {
  grepCommand,
  VALID_COMMANDS,
  chatPrompt,
  recentChatHistory,
  sourceIdentifier,
} = require("./index");

const VALID_CHAT_MODE = ["automatic", "chat", "query"];

// AMAdocs: detect whether a retrieved source is an image (caption/OCR doc), so
// image-grounded answers can be kept memory-less (nothing to discuss, and the
// model cannot actually see the picture). Matches the image file extension on
// the source title OR the section markers asImage writes into pageContent.
const AMADOCS_IMAGE_EXT = /\.(jpe?g|png|gif|webp|hei[cf]|bmp|tiff?|avif)$/i;
function amadocsIsImageSource(source = {}) {
  if (AMADOCS_IMAGE_EXT.test(source?.title || "")) return true;
  const text = source?.text || "";
  return /(^|\n)Image description:|(^|\n)Text found in image:/.test(text);
}

// AMAdocs: runtime-injected clause for image answers — the model reads an
// automated text description, it never sees the image. Appended in-flight so it
// applies to every workspace immediately (not subject to the openAiPrompt-baking
// gotcha that affects saneDefaultSystemPrompt edits).
const AMADOCS_IMAGE_PROMPT =
  "The context below is an automated description of an image plus any text detected in it. " +
  "You CANNOT see the image yourself — you are only reading this text description. " +
  "Answer by relaying what the description and detected text state. " +
  "Do not claim to view, look at, or visually inspect the image, and do not invent any visual detail that is not in the description.";

async function streamChatWithWorkspace(
  response,
  workspace,
  message,
  chatMode = "automatic",
  user = null,
  thread = null,
  attachments = [],
  sessionId = null, // AMAdocs: per-launch session id → scopes chat history to one sitting
  scopePath = null  // AMAdocs: LanceDB pre-filter — folder prefix (trailing /) or exact file path
) {
  const uuid = uuidv4();
  const updatedMessage = await grepCommand(message, user);

  if (Object.keys(VALID_COMMANDS).includes(updatedMessage)) {
    const data = await VALID_COMMANDS[updatedMessage](
      workspace,
      message,
      uuid,
      user,
      thread
    );
    writeResponseChunk(response, data);
    return;
  }

  // If is agent enabled chat we will exit this flow early.
  const isAgentChat = await grepAgents({
    uuid,
    response,
    message: updatedMessage,
    user,
    workspace,
    thread,
    attachments,
  });
  if (isAgentChat) return;

  const {
    connector: LLMConnector,
    routingMetadata,
    prefetchedContext,
    error: routerError,
  } = await resolveLLMConnector({
    workspace,
    message: updatedMessage,
    user,
    thread,
    attachments,
  });

  if (routerError) {
    return writeResponseChunk(response, {
      id: uuid,
      type: "abort",
      textResponse: null,
      sources: [],
      close: true,
      error: routerError,
    });
  }

  if (routingMetadata?.routedTo?.shouldNotify) {
    writeResponseChunk(response, {
      uuid: `${uuid}:route`,
      type: "modelRouteNotification",
      routedTo: routingMetadata.routedTo,
    });
  }

  const VectorDb = getVectorDbClass();

  const messageLimit = workspace?.openAiHistory || 20;
  const hasVectorizedSpace = await VectorDb.hasNamespace(workspace.slug);
  const embeddingsCount = await VectorDb.namespaceCount(workspace.slug);

  // User is trying to query-mode chat a workspace that has no data in it - so
  // we should exit early as no information can be found under these conditions.
  if ((!hasVectorizedSpace || embeddingsCount === 0) && chatMode === "query") {
    const textResponse =
      workspace?.queryRefusalResponse ??
      "There is no relevant information in this workspace to answer your query.";
    writeResponseChunk(response, {
      id: uuid,
      type: "textResponse",
      textResponse,
      sources: [],
      attachments,
      close: true,
      error: null,
    });
    await WorkspaceChats.new({
      workspaceId: workspace.id,
      prompt: message,
      response: {
        text: textResponse,
        sources: [],
        type: chatMode,
        attachments,
      },
      threadId: thread?.id || null,
      apiSessionId: sessionId,
      include: false,
      user,
    });
    return;
  }

  // If we are here we know that we are in a workspace that is:
  // 1. Chatting in "chat" mode and may or may _not_ have embeddings
  // 2. Chatting in "query" mode and has at least 1 embedding
  let completeText;
  let metrics = {};
  let contextTexts = [];
  let sources = [];
  let pinnedDocIdentifiers = [];

  // If the router pre-fetched context we can reuse it; otherwise fetch fresh.
  const {
    rawHistory,
    chatHistory,
    pinnedDocs: prefetchedPinnedDocs,
    parsedFiles: prefetchedParsedFiles,
  } = prefetchedContext ??
  // AMAdocs: apiSessionId scopes history to the current launch session, so a
  // fresh launch (new sessionId) never replays an earlier conversation.
  (await recentChatHistory({
    user,
    workspace,
    thread,
    messageLimit,
    apiSessionId: sessionId,
  }));

  // Pinned docs — reuse pre-fetched if available, otherwise fetch with token cap.
  const pinnedDocs =
    prefetchedPinnedDocs ??
    (await new DocumentManager({
      workspace,
      maxTokens: LLMConnector.promptWindowLimit(),
    }).pinnedDocs());
  pinnedDocs.forEach((doc) => {
    const { pageContent, ...metadata } = doc;
    pinnedDocIdentifiers.push(sourceIdentifier(doc));
    contextTexts.push(doc.pageContent);
    sources.push({
      text:
        pageContent.slice(0, 1_000) + "...continued on in source document...",
      ...metadata,
    });
  });

  // Parsed files — reuse pre-fetched if available, otherwise fetch fresh.
  const parsedFiles =
    prefetchedParsedFiles ??
    (await WorkspaceParsedFiles.getContextFiles(
      workspace,
      thread || null,
      user || null
    ));
  parsedFiles.forEach((doc) => {
    const { pageContent, ...metadata } = doc;
    contextTexts.push(doc.pageContent);
    sources.push({
      text:
        pageContent.slice(0, 1_000) + "...continued on in source document...",
      ...metadata,
    });
  });

  const vectorSearchResults =
    embeddingsCount !== 0
      ? await VectorDb.performSimilaritySearch({
          namespace: workspace.slug,
          input: updatedMessage,
          LLMConnector,
          similarityThreshold: workspace?.similarityThreshold,
          topN: workspace?.topN,
          filterIdentifiers: pinnedDocIdentifiers,
          rerank: workspace?.vectorSearchMode === "rerank",
          scopePath,
        })
      : {
          contextTexts: [],
          sources: [],
          message: null,
        };

  // Failed similarity search if it was run at all and failed.
  if (!!vectorSearchResults.message) {
    writeResponseChunk(response, {
      id: uuid,
      type: "abort",
      textResponse: null,
      sources: [],
      close: true,
      error: vectorSearchResults.message,
    });
    return;
  }

  const { fillSourceWindow } = require("../helpers/chat");
  const filledSources = fillSourceWindow({
    nDocs: workspace?.topN || 4,
    searchResults: vectorSearchResults.sources,
    history: rawHistory,
    filterIdentifiers: pinnedDocIdentifiers,
  });

  // Why does contextTexts get all the info, but sources only get current search?
  // This is to give the ability of the LLM to "comprehend" a contextual response without
  // populating the Citations under a response with documents the user "thinks" are irrelevant
  // due to how we manage backfilling of the context to keep chats with the LLM more correct in responses.
  // If a past citation was used to answer the question - that is visible in the history so it logically makes sense
  // and does not appear to the user that a new response used information that is otherwise irrelevant for a given prompt.
  // TLDR; reduces GitHub issues for "LLM citing document that has no answer in it" while keep answers highly accurate.
  contextTexts = [...contextTexts, ...filledSources.contextTexts];
  sources = [...sources, ...vectorSearchResults.sources];

  // If in query mode and no context chunks are found from search, backfill, or pins -  do not
  // let the LLM try to hallucinate a response or use general knowledge and exit early
  if (chatMode === "query" && contextTexts.length === 0) {
    const textResponse =
      workspace?.queryRefusalResponse ??
      "There is no relevant information in this workspace to answer your query.";
    writeResponseChunk(response, {
      id: uuid,
      type: "textResponse",
      textResponse,
      sources: [],
      close: true,
      error: null,
    });

    await WorkspaceChats.new({
      workspaceId: workspace.id,
      prompt: message,
      response: {
        text: textResponse,
        sources: [],
        type: chatMode,
        attachments,
      },
      threadId: thread?.id || null,
      apiSessionId: sessionId,
      include: false,
      user,
    });
    return;
  }

  // AMAdocs: if every retrieved source is an image, treat this as an image
  // answer — drop conversation history (nothing to discuss; the model can't see
  // the picture) and add the "you can't view the image" clause. Mixed/text
  // results keep normal (session-scoped) memory.
  const imageGrounded = sources.length > 0 && sources.every(amadocsIsImageSource);
  const promptRawHistory = imageGrounded ? [] : rawHistory;
  const promptChatHistory = imageGrounded ? [] : chatHistory;

  // Compress & Assemble message to ensure prompt passes token limit with room for response
  // and build system messages based on inputs and history.
  // Reuse the system prompt from routing pre-fetch when available.
  let systemPrompt =
    prefetchedContext?.systemPrompt ??
    (await chatPrompt(workspace, user, {
      prompt: updatedMessage,
      rawHistory: promptRawHistory,
    }));
  if (imageGrounded) systemPrompt += `\n\n${AMADOCS_IMAGE_PROMPT}`;
  const messages = await LLMConnector.compressMessages(
    {
      systemPrompt,
      userPrompt: updatedMessage,
      contextTexts,
      chatHistory: promptChatHistory,
      attachments,
    },
    promptRawHistory
  );

  // If streaming is not explicitly enabled for connector
  // we do regular waiting of a response and send a single chunk.
  if (LLMConnector.streamingEnabled() !== true) {
    console.log(
      `\x1b[31m[STREAMING DISABLED]\x1b[0m Streaming is not available for ${LLMConnector.constructor.name}. Will use regular chat method.`
    );
    const { textResponse, metrics: performanceMetrics } =
      await LLMConnector.getChatCompletion(messages, {
        temperature: workspace?.openAiTemp ?? LLMConnector.defaultTemp,
        user: user,
      });

    completeText = textResponse;
    metrics = performanceMetrics;
    writeResponseChunk(response, {
      uuid,
      sources,
      type: "textResponseChunk",
      textResponse: completeText,
      close: true,
      error: false,
      metrics,
    });
  } else {
    const stream = await LLMConnector.streamGetChatCompletion(messages, {
      temperature: workspace?.openAiTemp ?? LLMConnector.defaultTemp,
      user: user,
    });
    completeText = await LLMConnector.handleStream(response, stream, {
      uuid,
      sources,
    });
    metrics = stream.metrics;
  }

  // AMAdocs: persist the turn for session memory — but never store image
  // answers, so they can't pollute a later (text) question in the same session.
  // apiSessionId keeps stored turns scoped to this launch session.
  if (completeText?.length > 0 && !imageGrounded) {
    const { chat } = await WorkspaceChats.new({
      workspaceId: workspace.id,
      prompt: message,
      response: {
        text: completeText,
        sources,
        type: chatMode,
        attachments,
        metrics,
      },
      threadId: thread?.id || null,
      apiSessionId: sessionId,
      user,
    });

    writeResponseChunk(response, {
      uuid,
      type: "finalizeResponseStream",
      close: true,
      error: false,
      chatId: chat.id,
      metrics,
    });
    return;
  }

  writeResponseChunk(response, {
    uuid,
    type: "finalizeResponseStream",
    close: true,
    error: false,
    metrics,
  });
  return;
}

async function resolveLLMConnector({
  workspace,
  message,
  user,
  thread,
  attachments,
}) {
  try {
    const result = await resolveProviderConnector({
      workspace,
      prompt: message,
      user,
      thread,
      attachments,
    });
    return { ...result, error: null };
  } catch (routerError) {
    return {
      connector: null,
      routingMetadata: null,
      prefetchedContext: null,
      error: `Model router error: ${routerError.message}`,
    };
  }
}

module.exports = {
  VALID_CHAT_MODE,
  streamChatWithWorkspace,
};
