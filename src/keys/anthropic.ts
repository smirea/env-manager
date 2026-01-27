import type { KeyDefinition } from "./index";

function isValidAnthropicKey(key: string): boolean {
  return /^sk-ant-[a-zA-Z0-9-_]+$/.test(key);
}

export const anthropicKey: KeyDefinition = {
  envName: "ANTHROPIC_API_KEY",
  description: "Anthropic/Claude API key for AI services",
  schemaType: "string:format(/^sk-ant-/)",

  validate(key: string): boolean {
    return isValidAnthropicKey(key);
  },

  async resolve(projectName: string): Promise<string> {
    const prompt = `go to https://platform.claude.com/settings/keys and create a new API key under the "local" workspace with the name "${projectName}". Return ONLY the key value, nothing else.`;

    const result = await Bun.$`claude --chrome ${prompt}`.text();
    let key = result.trim();

    if (!isValidAnthropicKey(key)) {
      const retryPrompt = `The previous response was not a valid API key. Please return ONLY the API key string that starts with 'sk-ant-', no other text.`;
      const retry = await Bun.$`claude --chrome ${retryPrompt}`.text();
      key = retry.trim();
    }

    return key;
  },
};
