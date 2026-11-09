import type {
  CompleteOptions,
  CompleteResult,
  DirectClient,
  ElicitationHandler,
  ElicitationRequest,
  ElicitationResponse,
  ListSkillsOptions,
  ListSkillsResult,
  LoadedSkillItem,
  LoadedSkillMarkdownItem,
  LoadSkillsFormat,
  LoadSkillsOptions,
  LoadSkillsResult,
  McpLogLevel,
  SearchSkillsOptions,
  SearchSkillsResult,
  Sep2640IndexEntry,
  SkillAssetManifest,
  SkillSearchResultItem,
} from '../../../index';

const markdownLoad: LoadSkillsOptions<'markdown'> = { format: 'markdown', activateSession: true };
const format: LoadSkillsFormat = markdownLoad.format ?? 'full';

const acceptEverything: ElicitationHandler = (request: ElicitationRequest): ElicitationResponse => ({
  action: request.mode === 'url' ? 'decline' : 'accept',
  content: {},
});

export async function useClient(client: DirectClient): Promise<string[]> {
  client.onElicitation(acceptEverything);
  const markdown: LoadSkillsResult<'markdown'> = await client.loadSkills(['release'], markdownLoad);
  const firstMarkdown: LoadedSkillMarkdownItem | undefined = markdown.skills[0];
  const full: LoadSkillsResult = await client.loadSkills(['release']);
  const firstFull: LoadedSkillItem | undefined = full.skills[0];
  const searchOptions: SearchSkillsOptions = { limit: 1 };
  const found: SearchSkillsResult = await client.searchSkills('release', searchOptions);
  const firstFound: SkillSearchResultItem | undefined = found.skills[0];
  const listOptions: ListSkillsOptions = { limit: 1 };
  const listed: ListSkillsResult = await client.listSkills(listOptions);
  const completeOptions: CompleteOptions = {
    ref: { type: 'ref/prompt', name: 'summarize' },
    argument: { name: 'id', value: 'T' },
  };
  const completed: CompleteResult = await client.complete(completeOptions);
  const level: McpLogLevel = 'info';
  await client.setLogLevel(level);
  const index: Sep2640IndexEntry[] = await client.listSep2640Skills();
  const assets: SkillAssetManifest = await client.collectSkillAssets();
  return [
    format,
    firstMarkdown?.id ?? '',
    firstFull?.id ?? '',
    firstFound?.id ?? '',
    String(listed.skills.length),
    String(completed.completion.values.length),
    String(index.length),
    String(assets.entries.length),
  ];
}
