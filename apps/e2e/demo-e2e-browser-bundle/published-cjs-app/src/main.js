import { listAndCallPing } from 'frontmcp-cjs-consumer';

const output = document.getElementById('tools');

listAndCallPing().then(
  (text) => {
    output.textContent = text;
  },
  (error) => {
    output.textContent = `error:${error instanceof Error ? error.message : String(error)}`;
  },
);
