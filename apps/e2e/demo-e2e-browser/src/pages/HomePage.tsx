import { useFrontMcp } from '@frontmcp/react';
import { StatusBadge } from '../components/StatusBadge';

export function HomePage() {
  const { status, tools, resources, resourceTemplates, prompts } = useFrontMcp();

  return (
    <div className="page">
      <div className="page-header">
        <h2>Dashboard</h2>
        <StatusBadge status={status} />
      </div>

      <div className="stat-grid" data-testid="stat-grid">
        <div className="stat-card" data-testid="stat-tools">
          <div className="stat-value">{tools.length}</div>
          <div className="stat-label">Tools</div>
        </div>
        <div className="stat-card" data-testid="stat-resources">
          <div className="stat-value">{resources.length}</div>
          <div className="stat-label">Resources</div>
        </div>
        <div className="stat-card" data-testid="stat-templates">
          <div className="stat-value">{resourceTemplates.length}</div>
          <div className="stat-label">Templates</div>
        </div>
        <div className="stat-card" data-testid="stat-prompts">
          <div className="stat-value">{prompts.length}</div>
          <div className="stat-label">Prompts</div>
        </div>
      </div>

      <div className="feature-grid">
        <FeatureCard title="Store" link="/store" description="Reactive Valtio stores with state:// MCP resources" />
        <FeatureCard
          title="OpenAPI"
          link="/openapi"
          description="PetStore API tools from OpenAPI spec in the browser"
        />
        <FeatureCard title="Hooks" link="/hooks" description="useCallTool, useReadResource, useGetPrompt" />
        <FeatureCard
          title="Components"
          link="/components"
          description="ToolForm, PromptForm, ResourceViewer, OutputDisplay"
        />
        <FeatureCard
          title="Router"
          link="/mcp/tools/greet"
          description="McpRoutes auto-generates tool/resource/prompt pages"
        />
        <FeatureCard title="DOM Reading" link="/dom" description="readDomById, readDomBySelector, ReadDomTool" />
        <FeatureCard title="DynamicRenderer" link="/renderer" description="ComponentRegistry + JSON tree rendering" />
        <FeatureCard title="Lifecycle" link="/lifecycle" description="Provider status transitions and connect flow" />
      </div>
    </div>
  );
}

function FeatureCard({ title, link, description }: { title: string; link: string; description: string }) {
  return (
    <a href={link} className="feature-card">
      <h3>{title}</h3>
      <p>{description}</p>
    </a>
  );
}
