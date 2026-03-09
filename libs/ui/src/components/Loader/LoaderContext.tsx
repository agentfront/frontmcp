import React, { createContext, useContext, useMemo } from 'react';

/** Variant identifiers for the built-in loader styles. */
export type LoaderVariant = 'spinner' | 'bar' | 'skeleton' | 'overlay';

/** Render function signature for custom loaders. */
export type CustomLoaderRender = (props: {
  variant: LoaderVariant;
  label?: string;
  value?: number;
}) => React.ReactElement;

export interface LoaderContextValue {
  customLoader?: CustomLoaderRender;
}

export const LoaderContext = createContext<LoaderContextValue>({});

/** Wrap your app to set a global custom loader for all `<Loader>` instances. */
export function LoaderProvider({
  custom,
  children,
}: {
  custom: CustomLoaderRender;
  children: React.ReactNode;
}): React.ReactElement {
  const value = useMemo(() => ({ customLoader: custom }), [custom]);
  return <LoaderContext.Provider value={value}>{children}</LoaderContext.Provider>;
}

export function useLoaderContext(): LoaderContextValue {
  return useContext(LoaderContext);
}
