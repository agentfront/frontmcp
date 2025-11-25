/**
 * In-memory data store for CRM demo
 */

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user' | 'viewer';
  status: 'active' | 'inactive' | 'pending';
  createdAt: string;
  lastLoginAt?: string;
}

export interface Activity {
  id: string;
  userId: string;
  type: 'login' | 'logout' | 'page_view' | 'action' | 'error';
  description: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

// Sample users
const users: Map<string, User> = new Map([
  [
    'user_001',
    {
      id: 'user_001',
      email: 'alice@example.com',
      name: 'Alice Johnson',
      role: 'admin',
      status: 'active',
      createdAt: '2024-01-15T10:00:00Z',
      lastLoginAt: '2024-11-25T09:30:00Z',
    },
  ],
  [
    'user_002',
    {
      id: 'user_002',
      email: 'bob@example.com',
      name: 'Bob Smith',
      role: 'user',
      status: 'active',
      createdAt: '2024-02-20T14:30:00Z',
      lastLoginAt: '2024-11-24T16:45:00Z',
    },
  ],
  [
    'user_003',
    {
      id: 'user_003',
      email: 'charlie@example.com',
      name: 'Charlie Brown',
      role: 'user',
      status: 'inactive',
      createdAt: '2024-03-10T08:15:00Z',
      lastLoginAt: '2024-10-01T11:00:00Z',
    },
  ],
  [
    'user_004',
    {
      id: 'user_004',
      email: 'diana@example.com',
      name: 'Diana Ross',
      role: 'viewer',
      status: 'active',
      createdAt: '2024-04-05T16:20:00Z',
      lastLoginAt: '2024-11-25T08:00:00Z',
    },
  ],
  [
    'user_005',
    {
      id: 'user_005',
      email: 'eve@example.com',
      name: 'Eve Williams',
      role: 'user',
      status: 'pending',
      createdAt: '2024-11-20T12:00:00Z',
    },
  ],
]);

// Sample activities
const activities: Activity[] = [
  {
    id: 'act_001',
    userId: 'user_001',
    type: 'login',
    description: 'User logged in from Chrome on macOS',
    metadata: { browser: 'Chrome', os: 'macOS', ip: '192.168.1.100' },
    timestamp: '2024-11-25T09:30:00Z',
  },
  {
    id: 'act_002',
    userId: 'user_001',
    type: 'page_view',
    description: 'Viewed dashboard',
    metadata: { page: '/dashboard' },
    timestamp: '2024-11-25T09:31:00Z',
  },
  {
    id: 'act_003',
    userId: 'user_002',
    type: 'action',
    description: 'Created new report',
    metadata: { reportId: 'rpt_123', reportName: 'Q4 Sales' },
    timestamp: '2024-11-24T16:50:00Z',
  },
  {
    id: 'act_004',
    userId: 'user_004',
    type: 'login',
    description: 'User logged in from Safari on iOS',
    metadata: { browser: 'Safari', os: 'iOS', ip: '10.0.0.50' },
    timestamp: '2024-11-25T08:00:00Z',
  },
  {
    id: 'act_005',
    userId: 'user_002',
    type: 'error',
    description: 'Failed to export data - permission denied',
    metadata: { errorCode: 'ERR_403', resource: '/api/export' },
    timestamp: '2024-11-24T17:00:00Z',
  },
];

let activityCounter = activities.length;
let userCounter = users.size;

/**
 * CRM Data Store - In-memory storage for demo purposes
 */
export const CrmStore = {
  // User operations
  users: {
    list: (filter?: { status?: User['status']; role?: User['role'] }): User[] => {
      let result = Array.from(users.values());
      if (filter?.status) {
        result = result.filter((u) => u.status === filter.status);
      }
      if (filter?.role) {
        result = result.filter((u) => u.role === filter.role);
      }
      return result;
    },

    get: (id: string): User | undefined => {
      return users.get(id);
    },

    getByEmail: (email: string): User | undefined => {
      return Array.from(users.values()).find((u) => u.email === email);
    },

    create: (data: Omit<User, 'id' | 'createdAt'>): User => {
      userCounter++;
      const id = `user_${String(userCounter).padStart(3, '0')}`;
      const user: User = {
        ...data,
        id,
        createdAt: new Date().toISOString(),
      };
      users.set(id, user);
      return user;
    },

    update: (id: string, data: Partial<Omit<User, 'id' | 'createdAt'>>): User | undefined => {
      const user = users.get(id);
      if (!user) return undefined;
      const updated = { ...user, ...data };
      users.set(id, updated);
      return updated;
    },

    delete: (id: string): boolean => {
      return users.delete(id);
    },
  },

  // Activity operations
  activities: {
    list: (filter?: { userId?: string; type?: Activity['type']; limit?: number }): Activity[] => {
      let result = [...activities];
      if (filter?.userId) {
        result = result.filter((a) => a.userId === filter.userId);
      }
      if (filter?.type) {
        result = result.filter((a) => a.type === filter.type);
      }
      // Sort by timestamp descending (newest first)
      result.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      if (filter?.limit) {
        result = result.slice(0, filter.limit);
      }
      return result;
    },

    get: (id: string): Activity | undefined => {
      return activities.find((a) => a.id === id);
    },

    create: (data: Omit<Activity, 'id' | 'timestamp'>): Activity => {
      activityCounter++;
      const activity: Activity = {
        ...data,
        id: `act_${String(activityCounter).padStart(3, '0')}`,
        timestamp: new Date().toISOString(),
      };
      activities.push(activity);
      return activity;
    },

    getStats: (userId?: string): { total: number; byType: Record<string, number> } => {
      const filtered = userId ? activities.filter((a) => a.userId === userId) : activities;
      const byType: Record<string, number> = {};
      for (const activity of filtered) {
        byType[activity.type] = (byType[activity.type] || 0) + 1;
      }
      return { total: filtered.length, byType };
    },
  },
};
