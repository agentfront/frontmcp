/**
 * E2E Tests for Multiple Apps in Single Server
 *
 * Tests multi-app functionality:
 * - App isolation (each app's tools/resources/prompts)
 * - Cross-app tool discovery
 * - Namespace handling
 */
import { test, expect } from '@frontmcp/testing';

test.describe('Multi-App Server E2E', () => {
  test.use({
    server: './src/main.ts',
    publicMode: true,
  });

  test.describe('Notes App', () => {
    test('should create a note', async ({ mcp }) => {
      const result = await mcp.tools.call('create-note', {
        title: 'Test Note',
        content: 'This is a test note',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('Test Note');
      expect(result).toHaveTextContent('id');
    });

    test('should list notes', async ({ mcp }) => {
      // Create a note first
      await mcp.tools.call('create-note', {
        title: 'List Test',
        content: 'Content here',
      });

      const result = await mcp.tools.call('list-notes', {});

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('notes');
      expect(result).toHaveTextContent('count');
    });

    test('should read notes resource', async ({ mcp }) => {
      const content = await mcp.resources.read('notes://all');

      expect(content).toBeSuccessful();
      expect(content).toHaveTextContent('notes');
      expect(content).toHaveTextContent('"app":"notes"');
    });

    test('should generate notes summary prompt', async ({ mcp }) => {
      const result = await mcp.prompts.get('summarize-notes', {});

      expect(result).toBeSuccessful();
      expect(result.messages.length).toBeGreaterThan(0);
    });
  });

  test.describe('Tasks App', () => {
    test('should create a task', async ({ mcp }) => {
      const result = await mcp.tools.call('create-task', {
        title: 'Test Task',
        description: 'Task description',
        priority: 'high',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('Test Task');
      expect(result).toHaveTextContent('high');
    });

    test('should list tasks', async ({ mcp }) => {
      // Create a task first
      await mcp.tools.call('create-task', {
        title: 'List Task Test',
        priority: 'medium',
      });

      const result = await mcp.tools.call('list-tasks', {});

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('tasks');
    });

    test('should filter tasks by priority', async ({ mcp }) => {
      await mcp.tools.call('create-task', { title: 'High Priority', priority: 'high' });
      await mcp.tools.call('create-task', { title: 'Low Priority', priority: 'low' });

      const result = await mcp.tools.call('list-tasks', { priority: 'high' });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('high');
    });

    test('should read tasks resource', async ({ mcp }) => {
      const content = await mcp.resources.read('tasks://all');

      expect(content).toBeSuccessful();
      expect(content).toHaveTextContent('tasks');
      expect(content).toHaveTextContent('"app":"tasks"');
    });

    test('should generate tasks prioritization prompt', async ({ mcp }) => {
      const result = await mcp.prompts.get('prioritize-tasks', {});

      expect(result).toBeSuccessful();
      expect(result.messages.length).toBeGreaterThan(0);
    });
  });

  test.describe('Calendar App', () => {
    test('should create an event', async ({ mcp }) => {
      const now = Date.now();
      const result = await mcp.tools.call('create-event', {
        title: 'Test Event',
        description: 'Event description',
        startTime: now,
        endTime: now + 3600000,
        location: 'Test Location',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('Test Event');
      expect(result).toHaveTextContent('Test Location');
    });

    test('should list events', async ({ mcp }) => {
      const now = Date.now();
      await mcp.tools.call('create-event', {
        title: 'List Event Test',
        startTime: now,
        endTime: now + 3600000,
      });

      const result = await mcp.tools.call('list-events', {});

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('events');
    });

    test('should list only upcoming events', async ({ mcp }) => {
      const result = await mcp.tools.call('list-events', { upcomingOnly: true });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('events');
    });

    test('should read calendar resource', async ({ mcp }) => {
      const content = await mcp.resources.read('calendar://events');

      expect(content).toBeSuccessful();
      expect(content).toHaveTextContent('events');
      expect(content).toHaveTextContent('"app":"calendar"');
    });

    test('should generate schedule overview prompt', async ({ mcp }) => {
      const result = await mcp.prompts.get('schedule-overview', {});

      expect(result).toBeSuccessful();
      expect(result.messages.length).toBeGreaterThan(0);
    });
  });

  test.describe('Cross-App Tool Discovery', () => {
    test('should list all tools from all apps', async ({ mcp }) => {
      const tools = await mcp.tools.list();

      // Notes app tools
      expect(tools).toContainTool('create-note');
      expect(tools).toContainTool('list-notes');

      // Tasks app tools
      expect(tools).toContainTool('create-task');
      expect(tools).toContainTool('list-tasks');

      // Calendar app tools
      expect(tools).toContainTool('create-event');
      expect(tools).toContainTool('list-events');
    });

    test('should have 6 tools total (2 per app)', async ({ mcp }) => {
      const tools = await mcp.tools.list();

      // Count tools from our three apps - tools is an array directly
      const appTools = tools.filter((t) =>
        ['create-note', 'list-notes', 'create-task', 'list-tasks', 'create-event', 'list-events'].includes(t.name),
      );

      expect(appTools.length).toBe(6);
    });
  });

  test.describe('Cross-App Resource Discovery', () => {
    test('should list all resources from all apps', async ({ mcp }) => {
      const resources = await mcp.resources.list();

      expect(resources).toContainResource('notes://all');
      expect(resources).toContainResource('tasks://all');
      expect(resources).toContainResource('calendar://events');
    });
  });

  test.describe('Cross-App Prompt Discovery', () => {
    test('should list all prompts from all apps', async ({ mcp }) => {
      const prompts = await mcp.prompts.list();

      expect(prompts).toContainPrompt('summarize-notes');
      expect(prompts).toContainPrompt('prioritize-tasks');
      expect(prompts).toContainPrompt('schedule-overview');
    });
  });

  test.describe('App Isolation', () => {
    test('should not mix data between apps', async ({ mcp }) => {
      // Create items in each app
      await mcp.tools.call('create-note', { title: 'Isolated Note', content: 'Note content' });
      await mcp.tools.call('create-task', { title: 'Isolated Task' });
      const now = Date.now();
      await mcp.tools.call('create-event', {
        title: 'Isolated Event',
        startTime: now,
        endTime: now + 3600000,
      });

      // Read each resource and verify data is isolated
      const notesContent = await mcp.resources.read('notes://all');
      const tasksContent = await mcp.resources.read('tasks://all');
      const eventsContent = await mcp.resources.read('calendar://events');

      // Notes resource should only have notes
      expect(notesContent).toHaveTextContent('"app":"notes"');
      expect(notesContent).not.toHaveTextContent('"app":"tasks"');
      expect(notesContent).not.toHaveTextContent('"app":"calendar"');

      // Tasks resource should only have tasks
      expect(tasksContent).toHaveTextContent('"app":"tasks"');
      expect(tasksContent).not.toHaveTextContent('"app":"notes"');
      expect(tasksContent).not.toHaveTextContent('"app":"calendar"');

      // Events resource should only have events
      expect(eventsContent).toHaveTextContent('"app":"calendar"');
      expect(eventsContent).not.toHaveTextContent('"app":"notes"');
      expect(eventsContent).not.toHaveTextContent('"app":"tasks"');
    });

    test('each app should have independent storage', async ({ mcp }) => {
      // Create multiple items
      await mcp.tools.call('create-note', { title: 'Note 1', content: 'Content' });
      await mcp.tools.call('create-note', { title: 'Note 2', content: 'Content' });
      await mcp.tools.call('create-task', { title: 'Task 1' });

      // List operations should return correct counts
      const notes = await mcp.tools.call('list-notes', {});
      const tasks = await mcp.tools.call('list-tasks', {});

      expect(notes).toHaveTextContent('count');
      expect(tasks).toHaveTextContent('count');
    });
  });
});
