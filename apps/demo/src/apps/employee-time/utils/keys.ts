// Site-aware Redis key builders for Employee Time app

export const SITES_SET = 'et:sites';
export const LEGACY_EMPLOYEES_SET = 'et:employees';

export function siteEmployeesSetKey(siteId: string) {
  return `et:site:${siteId}:employees`;
}

export function employeeSitesSetKey(employeeId: string) {
  return `et:emp:${employeeId}:sites`;
}

export function openKey(siteId: string, employeeId: string) {
  return `et:open:${siteId}:${employeeId}`;
}

export function hoursKey(siteId: string, employeeId: string, day: string) {
  return `et:hours:${siteId}:${employeeId}:${day}`;
}

export function sessionsKey(siteId: string, employeeId: string, day: string) {
  return `et:sessions:${siteId}:${employeeId}:${day}`;
}
