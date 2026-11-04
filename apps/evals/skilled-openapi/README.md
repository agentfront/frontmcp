# Skilled OpenAPI model evaluation

Measures whether a real model completes tasks with the Skilled OpenAPI plugin. The protocol e2e tests
(`apps/e2e/demo-e2e-skilled-openapi`) check what the server answers; this checks what a model does with those answers:
does it find the right skill with `search_skill`, load it with `load_skill`, run the action with `execute_action` or
`run_workflow`, and tell the user the right thing?

The eval sends real requests to the Claude API, so it costs money and needs your API key. It never runs in CI. Its dry
run, which plays a fixed script in place of a model, does: it runs in this project's `test` target, so the harness
can't break unnoticed.

## What a run does

1. Starts the e2e app's server (`apps/e2e/demo-e2e-skilled-openapi/src/main.ts`) in its production settings: a bundle
   signed at start, `unprotectedOps: 'deny'`, and the mock billing API over HTTPS. The billing API holds invoice
   `INV-1001` (open, paid 120) and answers its reports at once.
2. For each task, resets the billing API, opens a new MCP session as an administrator, and lists the tools.
3. Gives the model the server's tools with their descriptions, and a system prompt with the server's `initialize`
   instructions and today's date. Sends the task's prompt, runs every tool call the model makes over MCP, and returns the
   results, until the model answers or reaches the turn limit.
4. Checks the outcome against the requests the billing API recorded and the model's final answer, never against what
   the model says it did.
5. Writes a JSON report and a text summary, and prints the summary.

## Running it

The dry run, with no API key and no network:

```bash
npx nx run evals-skilled-openapi:eval:dry-run
```

The real eval, with the current Sonnet model:

```bash
export ANTHROPIC_API_KEY=...   # from your shell or secret manager; never commit it
npx nx run evals-skilled-openapi:eval
```

Both build the plugin and the testing library first. The unit tests and the dry run:

```bash
npx nx test evals-skilled-openapi
```

### Environment variables

| Variable                  | Default                          | What it sets                                                               |
| ------------------------- | -------------------------------- | -------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`       | none: required for the real eval | The Claude API key. The harness passes it only to the API client.          |
| `SKILLED_EVAL_MODEL`      | `claude-sonnet-5-5`              | The model id, for example `claude-opus-5-5` or `claude-haiku-5-5`.         |
| `SKILLED_EVAL_EFFORT`     | the model's default              | `low`, `medium`, `high`, `xhigh` or `max`, sent as `output_config.effort`. |
| `SKILLED_EVAL_MAX_TURNS`  | `10`                             | The most requests sent to the model for one task.                          |
| `SKILLED_EVAL_TASKS`      | all tasks                        | A comma-separated list of task ids to run, for example `invoice-status`.   |
| `SKILLED_EVAL_REPORT_DIR` | `dist/evals/skilled-openapi`     | Where the report and the summary are written.                              |

The key is read from the environment only. It isn't printed, logged, written to the report, or passed to the server the
harness starts.

### Cost

A run of the five tasks sends about 15 to 30 requests, and at most 50 (five tasks times `SKILLED_EVAL_MAX_TURNS`). Each
request carries about 2,500 tokens of tool definitions and system prompt, then the conversation so far, which grows to
about 4,000 to 6,000 tokens once a skill is loaded. A run takes about 60,000 to 120,000 input tokens, most of them read
from the prompt cache, since every task shares the same tools and system prompt, and about 5,000 to 20,000 output
tokens. With Claude Sonnet 5.5 that is well under one US dollar per run. The summary's `Tokens` line gives the real
figures for each run.

## The tasks

| Id                       | Prompt                                                                               | Passes when                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `invoice-status`         | What's the status of invoice INV-1001?                                               | The invoice was read, nothing was changed, and the answer says it's open.                         |
| `refund-within-limit`    | Refund 50 from invoice INV-1001 and tell me the refund id.                           | Exactly one refund of 50 went through, nothing else changed, and the answer gives `rfnd_1`.       |
| `refund-over-limit`      | Refund 500 from invoice INV-1001.                                                    | No refund went through, and the answer names 120, the limit the API's error body gives.           |
| `export-revenue-report`  | Export last month's revenue report, and tell me the export id and the total revenue. | Last month was exported, the revenue report was read, and the answer gives `exp_1` and 1234.      |
| `account-plan-by-search` | Which plan is the billing account on, and how many seats does it have?               | The account plan was read, nothing was changed, and the answer gives the growth plan and 5 seats. |

`account-plan-by-search` needs a skill the model has to search for: the catalog in `search_skill`'s description lists
each skill with a one-line description, and none of them mentions the account plan (the dry run checks this). The
model can search, or guess that the Reports skill has it.

## Reading the report

The summary has a block for each task, then the totals. It looks like this (the figures are illustrative):

```text
Skilled OpenAPI eval, claude-sonnet-5-5: 4 of 5 tasks passed

PASS invoice-status: 2 tool calls (load_skill > execute_action) in 3 turns, 6.2 s
     input 2,912, cache read 5,104, cache write 2,551, output 412 tokens
FAIL refund-over-limit: 3 tool calls (load_skill > execute_action) in 4 turns, 9.8 s
     ...
     - not met: the answer names the most that can be refunded, 120
```

- `PASS` or `FAIL`, then each expectation that wasn't met.
- The number of tool calls, and the tools in the order the model called them (a call repeated back to back is shown
  once): the search, load, then execute order.
- `turns` is the number of requests sent to the model; the time is the task's wall-clock time, model and tools
  together.
- The tokens: uncached input, cache reads, cache writes and output.
- `stopped:` when the run ended without an answer: `turn_limit`, `max_tokens`, `refusal`, or `error` with the API's
  error.
- `ran an action before loading a skill` when an `execute_action` or `run_workflow` call came before any `load_skill`,
  and `reloaded <skill>` when a skill already loaded was loaded again.

The JSON report (`<model>-<start time>.json`) holds the same for each task, under `check`, `metrics` and `transcript`:
every tool call with its input, the text the model was given and its structured content, and `apiRequests`, the
requests that reached the billing API with their bodies and statuses, without the credential they carried. `totals`
adds up the tasks.

The model sees nothing but the server's own tools, descriptions and instructions. A failure points at what the plugin
or the bundle tells the model, or at the model; read the task's transcript to see which.

## Adding a task

Add an entry to `createEvalTasks` in `src/tasks.ts`:

- `id` and `prompt`: what a user would ask.
- `expectations`: what must hold afterwards, judged on the requests the billing API recorded and on the answer. Use the
  helpers in the file (`answered`, `changedNothing`, `changedOnly`, `answerMatches`), or write a `holds` function.
  Check the outcome, not the route: a model that reaches the right result another way passes.
- `dryRun`: the tool calls that complete the task, turn by turn, and the answer. The dry run plays them against the real
  server, so a task whose dry run fails has a wrong script or a wrong check.

If the task needs data the billing API doesn't have, extend the mock in
`apps/e2e/demo-e2e-skilled-openapi/e2e/helpers/mock-billing-api.ts` with an option that leaves the e2e tests'
behavior as it is, and add a test for the new task's checks to `src/__tests__/tasks.spec.ts`.

## Adding a model provider

The harness talks to a model through `EvalModel` in `src/model.ts`: start a conversation with a system prompt and tools,
then send the prompt or the tool results and get a reply, with its text, tool calls, stop reason and token usage. The
adapter keeps the conversation's history in its provider's own format. `src/anthropic-model.ts` is the Claude adapter;
another provider needs one more file like it, and a way to pick it in `src/cli.ts`.
