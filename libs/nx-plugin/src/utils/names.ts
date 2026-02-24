import { names } from '@nx/devkit';

export function toClassName(name: string): string {
  return names(name).className;
}

export function toPropertyName(name: string): string {
  return names(name).propertyName;
}

export function toFileName(name: string): string {
  return names(name).fileName;
}

export function toConstantName(name: string): string {
  return names(name).constantName;
}

export function sanitizeProjectName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}
