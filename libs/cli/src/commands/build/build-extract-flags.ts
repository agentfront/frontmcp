/** A build reads an entry under both; the generated CLI, which runs the server, sets only the first. */
const BUILD_EXTRACT_FLAGS = ['FRONTMCP_SCHEMA_EXTRACT', 'FRONTMCP_BUILD_EXTRACT'] as const;

/** Set the flags a build reads an entry under, and return what puts back the values they had. */
export function setBuildExtractFlags(): () => void {
  const previous = BUILD_EXTRACT_FLAGS.map((flag) => [flag, process.env[flag]] as const);
  for (const flag of BUILD_EXTRACT_FLAGS) process.env[flag] = '1';
  return () => {
    for (const [flag, value] of previous) {
      if (value === undefined) delete process.env[flag];
      else process.env[flag] = value;
    }
  };
}
