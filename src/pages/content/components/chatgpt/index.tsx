import { useCallback, useEffect, useRef } from 'react';
import { useMessageHandler } from '../../shared/useMessageHandler';

const APIBEAM_SOURCE = 'apibeam';
const APIBEAM_RESPONSE = 'apibeam-response';
const LOCAL_API_BASE = 'http://127.0.0.1:3000/';
const LOCAL_ROOM_ID = 'local-cline';
const WORKER_SESSION_KEY = '__apibeam_worker';

const sleep = (ms: number) =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

const isDedicatedWorkerTab = () => {
  const requested =
    new URLSearchParams(window.location.search).get('apibeam') === '1';
  if (requested) window.sessionStorage.setItem(WORKER_SESSION_KEY, '1');
  return requested || window.sessionStorage.getItem(WORKER_SESSION_KEY) === '1';
};

const waitForComposer = async (
  timeoutMs = 20000,
): Promise<HTMLElement | null> => {
  const deadline = Date.now() + timeoutMs;
  const selectors = [
    '#prompt-textarea',
    'div.ProseMirror[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"][role="textbox"]',
    'textarea[placeholder]',
  ];
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const element = document.querySelector(selector) as HTMLElement | null;
      if (element) return element;
    }
    await sleep(150);
  }
  return null;
};

const waitForSendButton = async (
  timeoutMs = 8000,
): Promise<HTMLButtonElement | null> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const button =
      (document.querySelector('#composer-submit-button') as HTMLButtonElement | null) ||
      (document.querySelector('button[data-testid="send-button"]') as HTMLButtonElement | null);
    const label = button?.getAttribute('aria-label')?.toLowerCase() || '';
    if (button && !button.disabled && !label.includes('stop')) return button;
    await sleep(100);
  }
  return null;
};

const isChatGenerating = () => {
  if (document.querySelector('[data-testid="stop-button"]')) return true;
  return Array.from(document.querySelectorAll('button')).some((button) => {
    const label = (button.getAttribute('aria-label') || '').toLowerCase();
    const testId = (button.getAttribute('data-testid') || '').toLowerCase();
    return label.includes('stop') || testId.includes('stop');
  });
};

const waitForRenderedAssistantResponse = async (
  previousCount: number,
  previousLastAssistant: HTMLElement | null,
  timeoutMs = 120000,
): Promise<string | null> => {
  const deadline = Date.now() + timeoutMs;
  const previousLastText = previousLastAssistant?.innerText.trim() || '';
  let lastText = '';
  let stableSince = 0;
  let firstTextAt = 0;
  let sawGenerating = false;

  while (Date.now() < deadline) {
    const messages = Array.from(
      document.querySelectorAll<HTMLElement>('[data-message-author-role="assistant"]'),
    );
    const latest = messages.at(-1) || null;
    const generating = isChatGenerating();
    sawGenerating ||= generating;

    const latestText = latest?.innerText.trim() || '';
    const isNewAssistant = Boolean(
      latest &&
        (messages.length > previousCount ||
          latest !== previousLastAssistant ||
          latestText !== previousLastText),
    );
    const text = isNewAssistant ? latestText : '';

    if (text) {
      if (!firstTextAt) firstTextAt = Date.now();
      if (text !== lastText) {
        lastText = text;
        stableSince = Date.now();
      }

      const stableFor = Date.now() - stableSince;
      const visibleFor = Date.now() - firstTextAt;
      const stableEnough = stableFor >= 2500 && visibleFor >= 2500;
      const conservativeFallback = !sawGenerating && stableFor >= 6000;
      if ((!generating && stableEnough) || conservativeFallback) return text;
    }
    await sleep(250);
  }
  return null;
};

const parseRenderedApiResponse = (text: string): any | null => {
  let candidate = text.trim();
  candidate = candidate.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  candidate = candidate.replace(/^json\s*[\r\n]+/i, '').trim();

  if (!candidate) return null;
  const startsLikeJson = candidate.startsWith('{') || candidate.startsWith('[');
  const endsLikeJson = candidate.endsWith('}') || candidate.endsWith(']');
  if (!startsLikeJson || !endsLikeJson) return null;

  try {
    const parsed = JSON.parse(candidate);
    return isLikelyApiResponse(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const isLikelyApiResponse = (value: any) =>
  Boolean(
    value && typeof value === 'object' &&
    (Array.isArray(value.choices) || value.error || Array.isArray(value.output) ||
      value.object === 'response' || typeof value.text === 'string'),
  );

type BridgeReply = { ok: boolean; data?: any; error?: string };

const sendRuntimeMessage = (message: any) =>
  new Promise<BridgeReply>((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve((response || { ok: false, error: 'No background response' }) as BridgeReply);
    });
  });

export const ChatGPT = () => {
  const activeHttpRequestId = useRef<string | null>(null);
  const workerMode = isDedicatedWorkerTab();

  const postHttpResponse = useCallback(async (requestId: string, message: any) => {
    const result = await sendRuntimeMessage({
      type: 'http_bridge_respond',
      content: { requestId, message },
    });
    if (!result.ok) throw new Error(result.error || 'ApiBeam response bridge failed');
  }, []);

  const reportQuestionError = useCallback(
    async (code: string, message: string) => {
      const requestId = activeHttpRequestId.current;
      const payload = {
        error: { code, message, type: 'apibeam_browser_error' },
      };

      if (workerMode && requestId) {
        try {
          await postHttpResponse(requestId, payload);
        } finally {
          activeHttpRequestId.current = null;
        }
        return;
      }

      chrome.runtime.sendMessage({
        type: 'question_error',
        error: payload.error,
      });
    },
    [postHttpResponse, workerMode],
  );

  const sendToChat = useCallback(
    async (
      content: { route: string; body?: object },
      prompt: string,
      _useTemporaryChat?: boolean,
    ) => {
      const contentArea = await waitForComposer();
      if (!contentArea) {
        await reportQuestionError(
          'composer_not_found',
          'ApiBeam waited for ChatGPT but the composer never became available.',
        );
        return;
      }

      const text = `${prompt ? `${prompt}\n` : ''}Route: ${content.route}\nPayload: ${JSON.stringify(content.body)}`;
      contentArea.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(contentArea);
      selection?.removeAllRanges();
      selection?.addRange(range);

      const inserted = document.execCommand('insertText', false, text);
      if (!inserted) {
        await reportQuestionError(
          'composer_input_failed',
          'ApiBeam could not update the ChatGPT composer.',
        );
        return;
      }

      const submitButton = await waitForSendButton();
      if (submitButton) {
        const assistantMessages = Array.from(
          document.querySelectorAll<HTMLElement>('[data-message-author-role="assistant"]'),
        );
        const assistantCount = assistantMessages.length;
        const previousLastAssistant = assistantMessages.at(-1) || null;
        const requestId = activeHttpRequestId.current;
        submitButton.click();
        if (workerMode && requestId) {
          void (async () => {
            const text = await waitForRenderedAssistantResponse(
              assistantCount,
              previousLastAssistant,
            );
            if (activeHttpRequestId.current !== requestId) return;

            if (!text) {
              try {
                await postHttpResponse(requestId, {
                  error: {
                    message: 'ApiBeam timed out waiting for the rendered ChatGPT response.',
                    type: 'apibeam_browser_error',
                    code: 'dom_response_timeout',
                  },
                });
              } catch (error) {
                console.error('[ApiBeam] DOM timeout delivery failed', error);
              } finally {
                if (activeHttpRequestId.current === requestId) {
                  activeHttpRequestId.current = null;
                }
              }
              return;
            }

            try {
              const parsed = parseRenderedApiResponse(text);
              await postHttpResponse(requestId, parsed ?? { text });
            } catch (error) {
              console.error('[ApiBeam] DOM response delivery failed', error);
            } finally {
              if (activeHttpRequestId.current === requestId) {
                activeHttpRequestId.current = null;
              }
            }
          })();
        }
        return;
      }

      await reportQuestionError(
        'composer_busy',
        'ChatGPT composer appeared, but the Send button never became ready.',
      );
    },
    [postHttpResponse, reportQuestionError, workerMode],
  );

  useMessageHandler(sendToChat);

  useEffect(() => {
    if (!workerMode) return;

    document.documentElement.dataset.apibeamWorker = 'starting';
    delete document.documentElement.dataset.apibeamError;
    const keepAlivePort = chrome.runtime.connect({ name: 'apibeam-keepalive' });
    chrome.runtime.sendMessage({ type: 'disconnect' }, () => {
      void chrome.runtime.lastError;
    });

    let stopped = false;
    void (async () => {
      while (!stopped) {
        try {
          const result = await sendRuntimeMessage({ type: 'http_bridge_poll' });
          if (!result.ok) {
            throw new Error(result.error || 'ApiBeam poll bridge failed');
          }

          const data = result.data;
          document.documentElement.dataset.apibeamWorker = 'connected';
          document.documentElement.dataset.apibeamLastPoll = String(Date.now());
          delete document.documentElement.dataset.apibeamError;
          const request = data?.request;
          if (request?.requestId && !activeHttpRequestId.current) {
            activeHttpRequestId.current = request.requestId;
            document.documentElement.dataset.apibeamRequestId = request.requestId;
            await sendToChat(request, '', false);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          document.documentElement.dataset.apibeamWorker = 'error';
          document.documentElement.dataset.apibeamError = message;
          console.warn('[ApiBeam] HTTP worker poll failed', error);
        }

        await sleep(activeHttpRequestId.current ? 400 : 700);
      }
    })();

    return () => {
      stopped = true;
      keepAlivePort.disconnect();
    };
  }, [sendToChat, workerMode]);

  useEffect(() => {
    const newScript = document.createElement('script');
    newScript.src = chrome.runtime.getURL('loader.js');
    document.body.appendChild(newScript);

    const listener = async (event: MessageEvent) => {
      if (event.source !== window) return;
      if (event.origin !== window.location.origin) return;

      const envelope = event.data;
      let response: any = null;
      if (
        envelope?.source === APIBEAM_SOURCE &&
        envelope?.type === APIBEAM_RESPONSE
      ) {
        response = envelope.data;
      } else {
        const keys =
          envelope && typeof envelope === 'object' ? Object.keys(envelope) : [];
        if (keys.length === 1 && keys[0] === 'data') {
          response = envelope.data;
        }
      }

      if (!isLikelyApiResponse(response)) return;

      const requestId = activeHttpRequestId.current;
      if (workerMode && requestId) {
        try {
          await postHttpResponse(requestId, response);
        } catch (error) {
          console.error('[ApiBeam] HTTP response delivery failed', error);
          return;
        }
        activeHttpRequestId.current = null;
        return;
      }

      chrome.runtime.sendMessage({
        type: 'question_answer',
        content: response,
      });
    };

    newScript.onload = () => window.addEventListener('message', listener);

    return () => {
      window.removeEventListener('message', listener);
      newScript.remove();
    };
  }, [postHttpResponse, workerMode]);

  return <div />;
};
