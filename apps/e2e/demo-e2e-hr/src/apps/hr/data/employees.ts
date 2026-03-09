export interface Employee {
  id: string;
  name: string;
  email: string;
  department: string;
  role: string;
  startDate: string;
  status: 'active' | 'on-leave' | 'offboarding';
  salaryBand: string;
  manager: string | null;
  location: string;
}

export interface SalaryBand {
  id: string;
  label: string;
  min: number;
  max: number;
}

export interface QuarterlyHiring {
  quarter: string;
  hires: number;
}

export const DEPARTMENTS = ['Engineering', 'Design', 'Sales', 'People Ops', 'Finance'] as const;

export const SALARY_BANDS: Record<string, SalaryBand> = {
  IC1: { id: 'IC1', label: 'IC1 - Junior', min: 70000, max: 95000 },
  IC2: { id: 'IC2', label: 'IC2 - Mid-Level', min: 95000, max: 130000 },
  IC3: { id: 'IC3', label: 'IC3 - Senior', min: 130000, max: 170000 },
  IC4: { id: 'IC4', label: 'IC4 - Staff', min: 170000, max: 220000 },
  M1: { id: 'M1', label: 'M1 - Manager', min: 140000, max: 185000 },
  M2: { id: 'M2', label: 'M2 - Director', min: 185000, max: 250000 },
  E1: { id: 'E1', label: 'E1 - VP', min: 250000, max: 350000 },
};

export const EMPLOYEES: Employee[] = [
  {
    id: 'E001',
    name: 'Sarah Chen',
    email: 'sarah.chen@acme.co',
    department: 'Engineering',
    role: 'Staff Engineer',
    startDate: '2021-03-15',
    status: 'active',
    salaryBand: 'IC4',
    manager: 'E002',
    location: 'San Francisco',
  },
  {
    id: 'E002',
    name: 'David Park',
    email: 'david.park@acme.co',
    department: 'Engineering',
    role: 'VP Engineering',
    startDate: '2020-01-10',
    status: 'active',
    salaryBand: 'E1',
    manager: null,
    location: 'San Francisco',
  },
  {
    id: 'E003',
    name: 'Maya Johnson',
    email: 'maya.johnson@acme.co',
    department: 'Design',
    role: 'Senior Designer',
    startDate: '2022-06-01',
    status: 'active',
    salaryBand: 'IC3',
    manager: 'E004',
    location: 'New York',
  },
  {
    id: 'E004',
    name: 'Alex Rivera',
    email: 'alex.rivera@acme.co',
    department: 'Design',
    role: 'Design Director',
    startDate: '2021-01-20',
    status: 'active',
    salaryBand: 'M2',
    manager: null,
    location: 'New York',
  },
  {
    id: 'E005',
    name: 'Jordan Lee',
    email: 'jordan.lee@acme.co',
    department: 'Sales',
    role: 'Account Executive',
    startDate: '2023-02-14',
    status: 'active',
    salaryBand: 'IC2',
    manager: 'E006',
    location: 'Chicago',
  },
  {
    id: 'E006',
    name: 'Taylor Morgan',
    email: 'taylor.morgan@acme.co',
    department: 'Sales',
    role: 'Sales Manager',
    startDate: '2021-09-01',
    status: 'active',
    salaryBand: 'M1',
    manager: null,
    location: 'Chicago',
  },
  {
    id: 'E007',
    name: 'Casey Kim',
    email: 'casey.kim@acme.co',
    department: 'People Ops',
    role: 'HR Coordinator',
    startDate: '2023-07-10',
    status: 'active',
    salaryBand: 'IC1',
    manager: 'E008',
    location: 'Remote',
  },
  {
    id: 'E008',
    name: 'Robin Patel',
    email: 'robin.patel@acme.co',
    department: 'People Ops',
    role: 'People Ops Manager',
    startDate: '2022-01-15',
    status: 'active',
    salaryBand: 'M1',
    manager: null,
    location: 'San Francisco',
  },
  {
    id: 'E009',
    name: 'Sam Nakamura',
    email: 'sam.nakamura@acme.co',
    department: 'Finance',
    role: 'Financial Analyst',
    startDate: '2023-04-03',
    status: 'on-leave',
    salaryBand: 'IC2',
    manager: 'E010',
    location: 'Remote',
  },
  {
    id: 'E010',
    name: 'Quinn Foster',
    email: 'quinn.foster@acme.co',
    department: 'Finance',
    role: 'Finance Director',
    startDate: '2020-11-01',
    status: 'active',
    salaryBand: 'M2',
    manager: null,
    location: 'New York',
  },
  {
    id: 'E011',
    name: 'Avery Thompson',
    email: 'avery.thompson@acme.co',
    department: 'Engineering',
    role: 'Junior Engineer',
    startDate: '2024-01-08',
    status: 'active',
    salaryBand: 'IC1',
    manager: 'E001',
    location: 'Remote',
  },
  {
    id: 'E012',
    name: 'Morgan Blake',
    email: 'morgan.blake@acme.co',
    department: 'Sales',
    role: 'Sales Rep',
    startDate: '2023-11-15',
    status: 'offboarding',
    salaryBand: 'IC1',
    manager: 'E006',
    location: 'Chicago',
  },
];

export const QUARTERLY_HIRING: QuarterlyHiring[] = [
  { quarter: 'Q1 2023', hires: 3 },
  { quarter: 'Q2 2023', hires: 2 },
  { quarter: 'Q3 2023', hires: 4 },
  { quarter: 'Q4 2023', hires: 1 },
  { quarter: 'Q1 2024', hires: 5 },
  { quarter: 'Q2 2024', hires: 3 },
  { quarter: 'Q3 2024', hires: 2 },
  { quarter: 'Q4 2024', hires: 4 },
];
