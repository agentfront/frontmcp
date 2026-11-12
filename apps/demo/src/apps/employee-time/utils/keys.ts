// Site-aware Redis key builders for Employee Time app

export const SITES_SET = 'et:sites';
export const LEGACY_EMPLOYEES_SET = 'et:employees';

/** Escape `%` and `:` in a key part, so different site and employee ids never build the same key. */
function keyPart(id: string): string {
  return id.replace(/%/g, '%25').replace(/:/g, '%3A');
}

export function siteEmployeesSetKey(siteId: string) {
  return `et:site:${keyPart(siteId)}:employees`;
}

export function employeeSitesSetKey(employeeId: string) {
  return `et:emp:${keyPart(employeeId)}:sites`;
}

export function openKey(siteId: string, employeeId: string) {
  return `et:open:${keyPart(siteId)}:${keyPart(employeeId)}`;
}

export function hoursKey(siteId: string, employeeId: string, day: string) {
  return `et:hours:${keyPart(siteId)}:${keyPart(employeeId)}:${day}`;
}

export function sessionsKey(siteId: string, employeeId: string, day: string) {
  return `et:sessions:${keyPart(siteId)}:${keyPart(employeeId)}:${day}`;
}
