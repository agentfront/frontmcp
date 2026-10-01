export default function GreetingWidget({ output }: { output: { greeting?: string } | null }) {
  return <p data-testid="esm-greeting">{output?.greeting ?? '...'}</p>;
}
