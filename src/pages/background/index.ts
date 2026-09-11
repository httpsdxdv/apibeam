import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';

// This fork is optimized for local Docker self-hosting.
export const DEFAULT_API_BASE_URL = 'http://localhost:3000/';
const chatgptBaseUrl = 'https://chatgpt.com';
const claudeBaseUrl = 'https://claude.ai/new';
const zaiBaseUrl = 'https://chat.z.ai';

const normalizeApiBaseUrl = (value: string) => {
  const trimmed = (value || DEFAULT_API_BASE_URL).trim().replace(/\/+$/, '');
  return `${trimmed}/`;
};

const buildProviderUrl = (
  provider: Provider,
  useTemporaryChat: boolean,
): string => {
  if (provider === 'claude') {
    return useTemporaryChat ? `${claudeBaseUrl}?incognito=` : claudeBaseUrl;
  }

  const url = provider === 'zai' ? zaiBaseUrl : chatgptBaseUrl;
  return useTemporaryChat ? `${url}?temporary-chat=true` : url;
};

export type Provider = 'chatgpt' | 'claude' | 'zai';

export type SettingsSchema = {
  language: string;
  method: string;
  roomId: string;
  useTemporaryChat?: boolean;
};

type RelayRequest = {
  requestId: string;
  route: string;
  body?: any;
  [key: string]: any;
};

type AgentMessage = {
  type:
    | 'question_answer'
    | 'question_error'
    | 'set_settings'
    | 'get_settings'
    | 'get_connect_url'
    | 'get_api_base_url'
    | 'set_api_base_url'
    | 'set_provider'
    | 'get_provider'
    | 'connect'
    | 'disconnect'
    | 'get_connection_status';
  content?: any;
  requestId?: string;
  error?: any;
};

let socketConnectionStatus: {
  status: 'pending' | 'connected' | 'failed' | 'disconnected';
  errorMessage?: string;
} = {
  status: 'disconnected',
  errorMessage: undefined,
};

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({
      url: chrome.runtime.getURL('src/pages/settings/index.html'),
    });
  }
});

const createNewRoom = () => {
  const roomId =
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15);
  chrome.storage.local.set({ roomId });
  return roomId;
};

const getRoomId = () =>
  new Promise<string>((resolve) => {
    chrome.storage.local.get('roomId', (settings) => {
      resolve(settings?.roomId || createNewRoom());
    });
  });

const getApiBaseUrl = () =>
  new Promise<string>((resolve) => {
    chrome.storage.local.get(['apiBaseUrl'], (result) => {
      resolve(normalizeApiBaseUrl(result.apiBaseUrl || DEFAULT_API_BASE_URL));
    });
  });

const getProvider = () =>
  new Promise<Provider>((resolve) => {
    chrome.storage.local.get(['provider'], (result) => {
      resolve((result.provider as Provider) || 'chatgpt');
    });
  });

const getUseTemporaryChat = () =>
  new Promise<boolean>((resolve) => {
    chrome.storage.local.get(['settings'], (result) => {
      const settings = result.settings as SettingsSchema | undefined;
      resolve(settings?.useTemporaryChat || false);
    });
  });

const getConnectUrl = async () => {
  const roomId = await getRoomId();
  const base = await getApiBaseUrl();
  return `${base}app/${roomId}`;
};

void getRoomId();

let tabId: number | undefined;
let socket: Socket | undefined;
const requestQueue: RelayRequest[] = [];
let activeRequest: RelayRequest | undefined;
let processingQueue = false;

const broadcastConnectionStatus = () => {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      if (!tab.id) return;
      chrome.tabs.sendMessage(
        tab.id,
        {
          type: 'get_connection_status',
          content: socketConnectionStatus,
        },
        () => chrome.runtime.lastError,
      );
    });
  });
};

const setConnectionStatus = (
  status: typeof socketConnectionStatus.status,
  errorMessage = '',
) => {
  socketConnectionStatus = { status, errorMessage };
  broadcastConnectionStatus();
};

const isProviderTab = (url: string | undefined, provider: Provider) => {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname;
    if (provider === 'chatgpt') return hostname === 'chatgpt.com';
    if (provider === 'claude') return hostname === 'claude.ai';
    return hostname === 'chat.z.ai';
  } catch {
    return false;
  }
};

const createProviderTab = (providerUrl: string) =>
  new Promise<number>((resolve, reject) => {
    chrome.tabs.create({ url: providerUrl, active: true }, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) return reject(new Error(error.message));
      if (!tab.id) return reject(new Error('Browser did not return a tab id'));
      tabId = tab.id;
      resolve(tab.id);
    });
  });

const ensureProviderTab = async (
  provider: Provider,
  providerUrl: string,
): Promise<number> => {
  if (tabId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (isProviderTab(tab.url, provider)) return tabId;
    } catch {
      // Tab was closed; create a replacement below.
    }
  }

  tabId = undefined;
  return createProviderTab(providerUrl);
};

const sendMessageToTabWithRetry = (
  id: number,
  payload: any,
  retries = 6,
  delay = 1000,
): Promise<void> =>
  new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(id, payload, () => {
      const error = chrome.runtime.lastError;
      if (!error) return resolve();

      if (retries <= 0) return reject(new Error(error.message));
      setTimeout(() => {
        sendMessageToTabWithRetry(id, payload, retries - 1, delay).then(
          resolve,
          reject,
        );
      }, delay);
    });
  });

const emitActiveFailure = async (message: string, code = 'browser_delivery_error') => {
  if (!activeRequest || !socket) return;
  const roomId = await getRoomId();
  socket.emit('clientResponse', {
    roomId,
    requestId: activeRequest.requestId,
    message: {
      error: {
        message,
        type: 'apibeam_browser_error',
        code,
      },
    },
  });
  activeRequest = undefined;
};

const processNextRequest = async () => {
  if (processingQueue || activeRequest || requestQueue.length === 0) return;
  if (!socket?.connected) return;

  processingQueue = true;
  activeRequest = requestQueue.shift();

  try {
    if (!activeRequest) return;

    const provider = await getProvider();
    const useTemporaryChat = await getUseTemporaryChat();
    const providerUrl = buildProviderUrl(provider, useTemporaryChat);

    let id = await ensureProviderTab(provider, providerUrl);
    const payload = {
      type: 'ask_question',
      content: activeRequest,
      useTemporaryChat,
    };

    try {
      await sendMessageToTabWithRetry(id, payload);
    } catch {
      // A stale/reloaded tab can lose its content script. Recreate the tab once
      // and retry instead of dropping the API request.
      tabId = undefined;
      id = await createProviderTab(providerUrl);
      await sendMessageToTabWithRetry(id, payload);
    }
  } catch (error) {
    await emitActiveFailure(
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    processingQueue = false;
    if (!activeRequest) void processNextRequest();
  }
};

const resetActiveBrowserRequest = async (requestId: string) => {
  // Remove a queued request that timed out before it reached the browser.
  const queuedIndex = requestQueue.findIndex(
    (request) => request.requestId === requestId,
  );
  if (queuedIndex >= 0) {
    requestQueue.splice(queuedIndex, 1);
    return;
  }

  if (activeRequest?.requestId !== requestId) return;

  // Reloading the dedicated provider tab aborts a late ChatGPT generation so
  // it cannot be mistaken for the next queued request.
  if (tabId) {
    try {
      await chrome.tabs.reload(tabId);
    } catch {
      tabId = undefined;
    }
  }

  activeRequest = undefined;
  setTimeout(() => void processNextRequest(), 2500);
};

async function connectWS() {
  const baseUrl = await getApiBaseUrl();

  if (socket?.connected) return;
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = undefined;
  }

  setConnectionStatus('pending');

  socket = io(baseUrl, {
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
  });

  socket.on('connect', async () => {
    const roomId = await getRoomId();
    const base = await getApiBaseUrl();

    setConnectionStatus('connected');
    try {
      const response = await fetch(
        `${base}connect/${roomId}?socketId=${encodeURIComponent(socket?.id || '')}`,
      );
      if (!response.ok) throw new Error(`Room join failed (${response.status})`);
      void processNextRequest();
    } catch (error) {
      setConnectionStatus(
        'failed',
        error instanceof Error ? error.message : String(error),
      );
    }
  });

  socket.on('disconnect', (reason) => {
    setConnectionStatus('disconnected', reason);
  });

  socket.on('connect_error', (error) => {
    setConnectionStatus('disconnected', error.message);
  });

  socket.on('serverMessage', (message: RelayRequest) => {
    if (!message?.requestId) {
      console.warn('[ApiBeam] Ignoring serverMessage without requestId', message);
      return;
    }
    requestQueue.push(message);
    void processNextRequest();
  });

  socket.on('cancelRequest', ({ requestId }: { requestId: string }) => {
    void resetActiveBrowserRequest(requestId);
  });
}

const disconnectWS = () => {
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = undefined;
  setConnectionStatus('disconnected');
};

chrome.runtime.onMessage.addListener(
  (msg: AgentMessage, sender, sendResponse) => {
    void (async () => {
      const senderTabId = sender.tab?.id;

      if (msg.type === 'question_answer' || msg.type === 'question_error') {
        if (!activeRequest || !socket) return;

        const roomId = await getRoomId();
        const requestId = activeRequest.requestId;
        const responseMessage =
          msg.type === 'question_answer'
            ? msg.content
            : {
                error: {
                  message:
                    msg.error?.message ||
                    msg.content?.message ||
                    'The browser could not submit the ApiBeam request.',
                  type: 'apibeam_browser_error',
                  code: msg.error?.code || 'browser_submission_error',
                },
              };

        socket.emit('clientResponse', {
          roomId,
          requestId,
          message: responseMessage,
        });

        activeRequest = undefined;
        void processNextRequest();
        return;
      }

      if (msg.type === 'set_settings') {
        await chrome.storage.local.set({ settings: msg.content });
        return;
      }

      if (msg.type === 'get_settings') {
        if (senderTabId) {
          const result = await chrome.storage.local.get('settings');
          chrome.tabs.sendMessage(senderTabId, {
            type: 'set_settings',
            content: result.settings,
          });
        }
        return;
      }

      if (msg.type === 'get_connect_url' || msg.type === 'get_api_base_url') {
        if (senderTabId) {
          const base = await getApiBaseUrl();
          const payload =
            msg.type === 'get_connect_url' ? await getConnectUrl() : base;
          chrome.tabs.sendMessage(senderTabId, {
            type:
              msg.type === 'get_connect_url'
                ? 'set_connect_url'
                : 'set_api_base_url',
            content: payload,
          });
        }
        return;
      }

      if (msg.type === 'set_api_base_url') {
        const newUrl = normalizeApiBaseUrl(String(msg.content || ''));
        await chrome.storage.local.set({ apiBaseUrl: newUrl });
        disconnectWS();
        await connectWS();

        if (senderTabId) {
          chrome.tabs.sendMessage(senderTabId, {
            type: 'set_connect_url',
            content: await getConnectUrl(),
          });
        }
        return;
      }

      if (msg.type === 'set_provider') {
        const provider = msg.content as Provider;
        await chrome.storage.local.set({ provider });
        if (senderTabId) {
          chrome.tabs.sendMessage(senderTabId, {
            type: 'set_provider',
            content: provider,
          });
        }
        return;
      }

      if (msg.type === 'get_provider') {
        if (senderTabId) {
          chrome.tabs.sendMessage(senderTabId, {
            type: 'set_provider',
            content: await getProvider(),
          });
        }
        return;
      }

      if (msg.type === 'connect') {
        await connectWS();
        return;
      }

      if (msg.type === 'disconnect') {
        disconnectWS();
        return;
      }

      if (msg.type === 'get_connection_status') {
        sendResponse({
          type: 'get_connection_status',
          content: socketConnectionStatus,
        });
      }
    })();

    return true;
  },
);

// Local Docker is the default in this fork; try to connect automatically.
void connectWS();
