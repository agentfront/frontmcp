export interface User {
  id: string;
  name: string;
  email: string;
  company: string;
  role: string;
  createdAt: string;
}

export interface Activity {
  id: string;
  userId: string;
  type: 'call' | 'email' | 'meeting' | 'note';
  description: string;
  timestamp: string;
}

class CrmStore {
  private users: Map<string, User> = new Map();
  private activities: Activity[] = [];

  constructor() {
    // Seed with sample data
    this.seedData();
  }

  private seedData(): void {
    const sampleUsers: User[] = [
      {
        id: 'user-1',
        name: 'John Doe',
        email: 'john@acme.com',
        company: 'Acme Inc',
        role: 'CEO',
        createdAt: '2024-01-01T00:00:00Z',
      },
      {
        id: 'user-2',
        name: 'Jane Smith',
        email: 'jane@globex.com',
        company: 'Globex Corp',
        role: 'CTO',
        createdAt: '2024-01-15T00:00:00Z',
      },
      {
        id: 'user-3',
        name: 'Bob Johnson',
        email: 'bob@initech.com',
        company: 'Initech',
        role: 'Manager',
        createdAt: '2024-02-01T00:00:00Z',
      },
    ];

    sampleUsers.forEach((u) => this.users.set(u.id, u));

    this.activities = [
      {
        id: 'act-1',
        userId: 'user-1',
        type: 'call',
        description: 'Initial sales call',
        timestamp: '2024-03-01T10:00:00Z',
      },
      { id: 'act-2', userId: 'user-1', type: 'email', description: 'Sent proposal', timestamp: '2024-03-02T14:00:00Z' },
      {
        id: 'act-3',
        userId: 'user-2',
        type: 'meeting',
        description: 'Product demo',
        timestamp: '2024-03-03T09:00:00Z',
      },
    ];
  }

  // User methods
  createUser(user: Omit<User, 'id' | 'createdAt'>): User {
    const newUser: User = {
      ...user,
      id: `user-${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    this.users.set(newUser.id, newUser);
    return newUser;
  }

  getUser(id: string): User | undefined {
    return this.users.get(id);
  }

  listUsers(): User[] {
    return Array.from(this.users.values());
  }

  updateUser(id: string, updates: Partial<Omit<User, 'id' | 'createdAt'>>): User | undefined {
    const user = this.users.get(id);
    if (!user) return undefined;
    const updated = { ...user, ...updates };
    this.users.set(id, updated);
    return updated;
  }

  deleteUser(id: string): boolean {
    return this.users.delete(id);
  }

  // Activity methods
  listActivities(userId?: string): Activity[] {
    if (userId) {
      return this.activities.filter((a) => a.userId === userId);
    }
    return [...this.activities];
  }

  logActivity(activity: Omit<Activity, 'id' | 'timestamp'>): Activity {
    const newActivity: Activity = {
      ...activity,
      id: `act-${Date.now()}`,
      timestamp: new Date().toISOString(),
    };
    this.activities.push(newActivity);
    return newActivity;
  }

  getActivityStats(): { total: number; byType: Record<string, number>; byUser: Record<string, number> } {
    const byType: Record<string, number> = {};
    const byUser: Record<string, number> = {};

    this.activities.forEach((a) => {
      byType[a.type] = (byType[a.type] || 0) + 1;
      byUser[a.userId] = (byUser[a.userId] || 0) + 1;
    });

    return {
      total: this.activities.length,
      byType,
      byUser,
    };
  }
}

export const crmStore = new CrmStore();
