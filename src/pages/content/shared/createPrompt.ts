// Shared prompt builder used by all providers.
export const createPrompt = (selectedLanguage: string, method: string): string => {
  return `Act as an OpenAI-compatible API adapter${
    selectedLanguage ? ` for a ${selectedLanguage} client` : ''
  }${method ? ` calling ${method}` : ''}. I will send you a Route and Payload. Execute the intent described by the payload and return exactly the JSON object that a real API endpoint for that route would return. For chat/completions, return a valid OpenAI chat completion object with choices (including tool_calls when the request requires a tool). For responses, return a valid Responses API object. Return only one valid JSON object: no Markdown fences, commentary, prefixes, or suffixes.`;
};
