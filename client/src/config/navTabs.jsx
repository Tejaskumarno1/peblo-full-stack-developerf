import { FileText, Calendar, ListTodo, LayoutGrid } from 'lucide-react';

export const MAIN_NAV_TABS = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    to: '/',
    match: (path) => path === '/',
  },
  {
    id: 'notes',
    label: 'Notes',
    to: '/notes',
    match: (path) => path.startsWith('/notes'),
  },
  {
    id: 'calendar',
    label: 'Calendar',
    to: '/calendar',
    match: (path) => path.startsWith('/calendar'),
  },
  {
    id: 'tasks',
    label: 'Tasks',
    to: '/todolist',
    match: (path) => path.startsWith('/todolist'),
  },
];

export const MOBILE_NAV_TABS = [
  {
    id: 'dashboard',
    label: 'Home',
    to: '/',
    match: (path) => path === '/',
    icon: <LayoutGrid size={22} strokeWidth={2} />,
  },
  {
    id: 'notes',
    label: 'Notes',
    to: '/notes',
    match: (path) => path.startsWith('/notes'),
    icon: <FileText size={22} strokeWidth={2} />,
  },
  {
    id: 'calendar',
    label: 'Calendar',
    to: '/calendar',
    match: (path) => path.startsWith('/calendar'),
    icon: <Calendar size={22} strokeWidth={2} />,
  },
  {
    id: 'tasks',
    label: 'Tasks',
    to: '/todolist',
    match: (path) => path.startsWith('/todolist'),
    icon: <ListTodo size={22} strokeWidth={2} />,
  },
];
