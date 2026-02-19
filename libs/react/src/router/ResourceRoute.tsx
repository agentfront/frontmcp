/**
 * ResourceRoute — displays ResourceViewer for a URI from the route path.
 */

import React from 'react';
import { useParams } from 'react-router-dom';
import { useReadResource } from '../hooks/useReadResource';
import { ResourceViewer } from '../components/ResourceViewer';
import type { ResourceContent } from '../components/ResourceViewer';

export function ResourceRoute(): React.ReactElement {
  const { '*': rawUri } = useParams();
  const uri = rawUri ? decodeURIComponent(rawUri) : '';
  const state = useReadResource(uri) as {
    data: { contents?: ResourceContent[] } | null;
    loading: boolean;
    error: Error | null;
    refetch: () => void;
  };

  return React.createElement(
    'div',
    null,
    React.createElement('h3', null, uri),
    React.createElement(ResourceViewer, { data: state.data, loading: state.loading, error: state.error }),
  );
}
