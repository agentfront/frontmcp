import { Prompt, PromptContext } from '@frontmcp/sdk';

/**
 * Multi-argument prompt used by the cli-prompts e2e suite (#382 round-2)
 * to verify that `prompt get <name> --<arg> <value>` accepts every declared
 * argument. The reporter's exact repro was:
 *   prompt get explain-calc --op add --a 2 --b 3
 * which round 1 rejected with "too many arguments for 'get'" because the
 * `get` subcommand had no `.option()` registrations.
 */
@Prompt({
  name: 'explain-calc',
  description: 'Explain the result of a basic arithmetic operation.',
  arguments: [
    { name: 'op', description: 'Operation: add | sub | mul | div', required: true },
    { name: 'a', description: 'Operand A', required: true },
    { name: 'b', description: 'Operand B', required: true },
  ],
})
export default class ExplainCalcPrompt extends PromptContext {
  async execute(args: Record<string, string>) {
    const { op, a, b } = args;
    const aNum = Number(a);
    const bNum = Number(b);
    let result: number | string;
    if (!Number.isFinite(aNum) || !Number.isFinite(bNum)) {
      result = `invalid operands: a=${a}, b=${b} (both must be numeric)`;
    } else {
      switch (op) {
        case 'add':
          result = aNum + bNum;
          break;
        case 'sub':
          result = aNum - bNum;
          break;
        case 'mul':
          result = aNum * bNum;
          break;
        case 'div':
          result = bNum === 0 ? 'undefined' : aNum / bNum;
          break;
        default:
          result = `unknown op: ${op}`;
      }
    }
    return {
      description: `${op} ${a} and ${b}`,
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `${op} ${a} and ${b} = ${result}`,
          },
        },
      ],
    };
  }
}
