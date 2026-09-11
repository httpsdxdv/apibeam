import { useCallback, useEffect } from 'react';
import { useMessageHandler } from '../../shared/useMessageHandler';

const APIBEAM_SOURCE = 'apibeam';
const APIBEAM_RESPONSE = 'apibeam-response';

const isLikelyApiResponse = (value: any) =>
  Boolean(
    value &&
      typeof value === 'object' &&
      (Array.isArray(value.choices) ||
        value.error ||
        Array.isArray(value.output) ||
        value.object === 'response' ||
        typeof value.text === 'string'),
  );

export const ChatGPT = () => {
  const sendToChat = useCallback(
    (
      content: { route: string; body?: object },
      prompt: string,
      _useTemporaryChat?: boolean,
    ) => {
      const contentArea = document.querySelector(
        '#prompt-textarea',
      ) as HTMLElement | null;

      if (!contentArea) {
        chrome.runtime.sendMessage({
          type: 'question_error',
          error: {
            code: 'composer_not_found',
            message: 'ApiBeam could not find the ChatGPT composer.',
          },
        });
        return;
      }

      const text = `${prompt ? `${prompt}\n` : ''}Route: ${content.route}\nPayload: ${JSON.stringify(content.body)}`;

      contentArea.focus();
      contentArea.textContent = text;
      contentArea.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'insertText',
          data: text,
        }),
      );

      window.setTimeout(() => {
        const submitButton =
          (document.querySelector(
            '#composer-submit-button',
          ) as HTMLButtonElement | null) ||
          (document.querySelector(
            'button[data-testid="send-button"]',
          ) as HTMLButtonElement | null);

        const ariaLabel = submitButton?.getAttribute('aria-label')?.toLowerCase() || '';
        const looksLikeStopButton = ariaLabel.includes('stop');

        if (submitButton && !submitButton.disabled && !looksLikeStopButton) {
          submitButton.click();
          return;
        }

        chrome.runtime.sendMessage({
          type: 'question_error',
          error: {
            code: 'composer_busy',
            message:
              'ChatGPT is still busy or its Send button could not be found. ApiBeam will return an error instead of interrupting another response.',
          },
        });
      }, 250);
    },
    [],
  );

  useMessageHandler(sendToChat);

  useEffect(() => {
    const newScript = document.createElement('script');
    newScript.src = chrome.runtime.getURL('loader.js');
    document.body.appendChild(newScript);

    const listener = (event: MessageEvent) => {
      if (event.source !== window) return;
      if (event.origin !== window.location.origin) return;
      const envelope = event.data;
      let response: any = null;

      // New tagged envelope (supported by future loaders).
      if (
        envelope?.source === APIBEAM_SOURCE &&
        envelope?.type === APIBEAM_RESPONSE
      ) {
        response = envelope.data;
      } else {
        // Backward-compatible support for the current upstream loader, which
        // posts exactly { data: parsed }. Requiring a single-key envelope and
        // an API-looking payload prevents MetaMask's
        // { name: 'metamask-provider', data: ... } events from being forwarded.
        const keys =
          envelope && typeof envelope === 'object' ? Object.keys(envelope) : [];
        if (keys.length === 1 && keys[0] === 'data') {
          response = envelope.data;
        }
      }

      if (!isLikelyApiResponse(response)) return;

      chrome.runtime.sendMessage({
        type: 'question_answer',
        content: response,
      });
    };

    newScript.onload = () => {
      window.addEventListener('message', listener);
    };

    return () => {
      window.removeEventListener('message', listener);
      newScript.remove();
    };
  }, []);

  return <div />;
};
