// All available permissions in the system
// Format: resource:action

export const PERMISSIONS = {
  // Vehicle (МПС) permissions
  VEHICLE_CREATE: 'vehicle:create',
  VEHICLE_READ: 'vehicle:read',
  VEHICLE_UPDATE: 'vehicle:update',
  VEHICLE_DELETE: 'vehicle:delete',

  // Owner permissions
  OWNER_CREATE: 'owner:create',
  OWNER_READ: 'owner:read',
  OWNER_UPDATE: 'owner:update',
  OWNER_DELETE: 'owner:delete',

  // User/Account management permissions
  USER_CREATE: 'user:create',
  USER_READ: 'user:read',
  USER_UPDATE: 'user:update',
  USER_DELETE: 'user:delete',
  USER_RESET_2FA: 'user:reset_2fa',

  // Role management permissions
  ROLE_CREATE: 'role:create',
  ROLE_READ: 'role:read',
  ROLE_UPDATE: 'role:update',
  ROLE_DELETE: 'role:delete',

  // Audit log permissions
  AUDIT_READ: 'audit:read',
  AUDIT_EXPORT: 'audit:export',

  // Request (Заявка) permissions
  REQUEST_CREATE: 'request:create',
  REQUEST_READ_OWN: 'request:read_own',
  REQUEST_READ_ALL: 'request:read_all',
  REQUEST_UPDATE_STATUS: 'request:update_status',
  REQUEST_RESPOND_OFFER: 'request:respond_offer',
  REQUEST_UPLOAD_DOCUMENT: 'request:upload_document',

  // Insurance (Падежи) permissions
  INSURANCE_READ: 'insurance:read',
  INSURANCE_MANAGE: 'insurance:manage',
  INSURANCE_AGENT_VIEW: 'insurance:agent_view',

  // Resource (Ресурси) permissions
  RESOURCE_READ: 'resource:read',
  RESOURCE_MANAGE: 'resource:manage',

  // Menu access permissions (for UI visibility)
  MENU_HOME: 'menu:home',
  MENU_VEHICLE_INSERT: 'menu:vehicle_insert',
  MENU_VEHICLE_LIST: 'menu:vehicle_list',
  MENU_INSURANCE: 'menu:insurance',
  MENU_INSURANCE_MANAGE: 'menu:insurance_manage',
  MENU_INSURANCE_AGENTS: 'menu:insurance_agents',
  MENU_ROLES: 'menu:roles',
  MENU_ACCOUNTS: 'menu:accounts',
  MENU_AUDIT_LOGS: 'menu:audit_logs',
  MENU_REQUEST_CREATE: 'menu:request_create',
  MENU_MY_REQUESTS: 'menu:my_requests',
  MENU_ALL_REQUESTS: 'menu:all_requests',
  MENU_RESOURCES: 'menu:resources',
  MENU_NOTIFICATIONS: 'menu:notifications',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// Permission groups for easier role assignment
export const PERMISSION_GROUPS = {
  VEHICLE_FULL: [
    PERMISSIONS.VEHICLE_CREATE,
    PERMISSIONS.VEHICLE_READ,
    PERMISSIONS.VEHICLE_UPDATE,
    PERMISSIONS.VEHICLE_DELETE,
    PERMISSIONS.OWNER_CREATE,
    PERMISSIONS.OWNER_READ,
    PERMISSIONS.OWNER_UPDATE,
    PERMISSIONS.OWNER_DELETE,
  ],
  VEHICLE_READ_ONLY: [
    PERMISSIONS.VEHICLE_READ,
    PERMISSIONS.OWNER_READ,
  ],
  USER_MANAGEMENT: [
    PERMISSIONS.USER_CREATE,
    PERMISSIONS.USER_READ,
    PERMISSIONS.USER_UPDATE,
    PERMISSIONS.USER_DELETE,
    PERMISSIONS.USER_RESET_2FA,
  ],
  ROLE_MANAGEMENT: [
    PERMISSIONS.ROLE_CREATE,
    PERMISSIONS.ROLE_READ,
    PERMISSIONS.ROLE_UPDATE,
    PERMISSIONS.ROLE_DELETE,
  ],
  AUDIT_ACCESS: [
    PERMISSIONS.AUDIT_READ,
    PERMISSIONS.AUDIT_EXPORT,
  ],
  INSURANCE_ACCESS: [
    PERMISSIONS.INSURANCE_READ,
  ],
  INSURANCE_ADMIN: [
    PERMISSIONS.INSURANCE_READ,
    PERMISSIONS.INSURANCE_MANAGE,
    PERMISSIONS.INSURANCE_AGENT_VIEW,
  ],
  REQUEST_AGENT: [
    PERMISSIONS.REQUEST_CREATE,
    PERMISSIONS.REQUEST_READ_OWN,
    PERMISSIONS.REQUEST_RESPOND_OFFER,
  ],
  REQUEST_STAFF: [
    PERMISSIONS.REQUEST_READ_ALL,
    PERMISSIONS.REQUEST_UPDATE_STATUS,
    PERMISSIONS.REQUEST_UPLOAD_DOCUMENT,
  ],
  ALL_MENUS: [
    PERMISSIONS.MENU_HOME,
    PERMISSIONS.MENU_VEHICLE_INSERT,
    PERMISSIONS.MENU_VEHICLE_LIST,
    PERMISSIONS.MENU_INSURANCE,
    PERMISSIONS.MENU_INSURANCE_MANAGE,
    PERMISSIONS.MENU_ROLES,
    PERMISSIONS.MENU_ACCOUNTS,
    PERMISSIONS.MENU_AUDIT_LOGS,
    PERMISSIONS.MENU_REQUEST_CREATE,
    PERMISSIONS.MENU_MY_REQUESTS,
    PERMISSIONS.MENU_ALL_REQUESTS,
    PERMISSIONS.MENU_RESOURCES,
    PERMISSIONS.MENU_INSURANCE_AGENTS,
  ],
  BASIC_MENUS: [
    PERMISSIONS.MENU_HOME,
    PERMISSIONS.MENU_VEHICLE_INSERT,
    PERMISSIONS.MENU_VEHICLE_LIST,
    PERMISSIONS.MENU_INSURANCE,
    PERMISSIONS.MENU_RESOURCES,
  ],
  AGENT_MENUS: [
    PERMISSIONS.MENU_HOME,
    PERMISSIONS.MENU_REQUEST_CREATE,
    PERMISSIONS.MENU_MY_REQUESTS,
    PERMISSIONS.MENU_INSURANCE,
  ],
} as const;

// Default roles with their permissions
export const DEFAULT_ROLES = {
  ADMIN: {
    name: 'Администратор',
    description: 'Пълен достъп до всички функции на системата',
    permissions: Object.values(PERMISSIONS),
    isSystem: true,
  },
  EMPLOYEE: {
    name: 'Служител',
    description: 'Въвеждане и преглед на МПС',
    permissions: [
      ...PERMISSION_GROUPS.VEHICLE_FULL,
      ...PERMISSION_GROUPS.BASIC_MENUS,
      ...PERMISSION_GROUPS.REQUEST_STAFF,
      ...PERMISSION_GROUPS.INSURANCE_ACCESS,
      PERMISSIONS.RESOURCE_READ,
      PERMISSIONS.MENU_ALL_REQUESTS,
      PERMISSIONS.MENU_INSURANCE,
      PERMISSIONS.MENU_RESOURCES,
    ],
    isSystem: true,
  },
  AGENT: {
    name: 'Агент',
    description: 'Създаване на заявки и преглед на оферти',
    permissions: [
      ...PERMISSION_GROUPS.REQUEST_AGENT,
      ...PERMISSION_GROUPS.AGENT_MENUS,
      PERMISSIONS.INSURANCE_READ,
      PERMISSIONS.INSURANCE_AGENT_VIEW,
      PERMISSIONS.VEHICLE_READ,
      PERMISSIONS.VEHICLE_UPDATE,
      PERMISSIONS.OWNER_READ,
      PERMISSIONS.OWNER_UPDATE,
    ],
    isSystem: true,
  },
} as const;

// Get all permissions as array for frontend
export function getAllPermissions(): { key: string; value: string; group: string }[] {
  const permissions: { key: string; value: string; group: string }[] = [];

  for (const [key, value] of Object.entries(PERMISSIONS)) {
    const group = key.split('_')[0];
    permissions.push({ key, value, group });
  }

  return permissions;
}

// Permission types
export type PermissionType = 'api' | 'page';

// Get permission display info
export const PERMISSION_LABELS: Record<Permission, { label: string; description: string; type: PermissionType; apiEndpoint?: string }> = {
  [PERMISSIONS.VEHICLE_CREATE]: { label: 'Създаване на МПС', description: 'Позволява добавяне на нови МПС в системата', type: 'api', apiEndpoint: 'POST /api/vehicles' },
  [PERMISSIONS.VEHICLE_READ]: { label: 'Преглед на МПС', description: 'Позволява разглеждане на списъка с МПС и детайлите им', type: 'api', apiEndpoint: 'GET /api/vehicles' },
  [PERMISSIONS.VEHICLE_UPDATE]: { label: 'Редактиране на МПС', description: 'Позволява промяна на данните на съществуващи МПС', type: 'api', apiEndpoint: 'PATCH /api/vehicles/:id' },
  [PERMISSIONS.VEHICLE_DELETE]: { label: 'Изтриване на МПС', description: 'Позволява премахване на МПС от системата', type: 'api', apiEndpoint: 'DELETE /api/vehicles/:id' },
  [PERMISSIONS.OWNER_CREATE]: { label: 'Създаване на собственик', description: 'Позволява добавяне на нови собственици', type: 'api', apiEndpoint: 'POST /api/owners' },
  [PERMISSIONS.OWNER_READ]: { label: 'Преглед на собственици', description: 'Позволява разглеждане на списъка със собственици', type: 'api', apiEndpoint: 'GET /api/owners' },
  [PERMISSIONS.OWNER_UPDATE]: { label: 'Редактиране на собственик', description: 'Позволява промяна на данните на собственик', type: 'api', apiEndpoint: 'PATCH /api/owners/:id' },
  [PERMISSIONS.OWNER_DELETE]: { label: 'Изтриване на собственик', description: 'Позволява премахване на собственик от системата', type: 'api', apiEndpoint: 'DELETE /api/owners/:id' },
  [PERMISSIONS.USER_CREATE]: { label: 'Създаване на потребител', description: 'Позволява създаване на нови потребителски акаунти', type: 'api', apiEndpoint: 'POST /api/users' },
  [PERMISSIONS.USER_READ]: { label: 'Преглед на потребители', description: 'Позволява разглеждане на списъка с потребители', type: 'api', apiEndpoint: 'GET /api/users' },
  [PERMISSIONS.USER_UPDATE]: { label: 'Редактиране на потребител', description: 'Позволява промяна на данните на потребител', type: 'api', apiEndpoint: 'PATCH /api/users/:id' },
  [PERMISSIONS.USER_DELETE]: { label: 'Изтриване на потребител', description: 'Позволява деактивиране на потребителски акаунт', type: 'api', apiEndpoint: 'DELETE /api/users/:id' },
  [PERMISSIONS.USER_RESET_2FA]: { label: 'Нулиране на 2FA', description: 'Позволява нулиране на двуфакторната автентикация на потребител', type: 'api', apiEndpoint: 'POST /api/users/:id/reset-2fa' },
  [PERMISSIONS.ROLE_CREATE]: { label: 'Създаване на роля', description: 'Позволява създаване на нови роли в системата', type: 'api', apiEndpoint: 'POST /api/roles' },
  [PERMISSIONS.ROLE_READ]: { label: 'Преглед на роли', description: 'Позволява разглеждане на списъка с роли', type: 'api', apiEndpoint: 'GET /api/roles' },
  [PERMISSIONS.ROLE_UPDATE]: { label: 'Редактиране на роля', description: 'Позволява промяна на настройките на роля', type: 'api', apiEndpoint: 'PATCH /api/roles/:id' },
  [PERMISSIONS.ROLE_DELETE]: { label: 'Изтриване на роля', description: 'Позволява премахване на роля от системата', type: 'api', apiEndpoint: 'DELETE /api/roles/:id' },
  [PERMISSIONS.AUDIT_READ]: { label: 'Преглед на одит лог', description: 'Позволява разглеждане на одит записите в системата', type: 'api', apiEndpoint: 'GET /api/audit' },
  [PERMISSIONS.AUDIT_EXPORT]: { label: 'Експорт на одит лог', description: 'Позволява експортиране на одит записи във файл', type: 'api', apiEndpoint: 'GET /api/audit/export' },
  [PERMISSIONS.REQUEST_CREATE]: { label: 'Създаване на заявка', description: 'Позволява създаване на нови заявки', type: 'api', apiEndpoint: 'POST /api/requests' },
  [PERMISSIONS.REQUEST_READ_OWN]: { label: 'Преглед на свои заявки', description: 'Позволява преглед на собствените заявки', type: 'api', apiEndpoint: 'GET /api/requests/my' },
  [PERMISSIONS.REQUEST_READ_ALL]: { label: 'Преглед на всички заявки', description: 'Позволява преглед на всички заявки в системата', type: 'api', apiEndpoint: 'GET /api/requests' },
  [PERMISSIONS.REQUEST_UPDATE_STATUS]: { label: 'Обработка на заявка', description: 'Позволява обработка на заявки и качване на оферти', type: 'api', apiEndpoint: 'PATCH /api/requests/:id/status' },
  [PERMISSIONS.REQUEST_RESPOND_OFFER]: { label: 'Отговор на оферта', description: 'Позволява приемане или отказване на оферта', type: 'api', apiEndpoint: 'PATCH /api/requests/:id/respond' },
  [PERMISSIONS.REQUEST_UPLOAD_DOCUMENT]: { label: 'Качване на документ', description: 'Позволява качване на документи за печат', type: 'api', apiEndpoint: 'POST /api/requests/:id/documents' },
  [PERMISSIONS.MENU_HOME]: { label: 'Начало', description: 'Показва началната страница в менюто', type: 'page' },
  [PERMISSIONS.MENU_VEHICLE_INSERT]: { label: 'Въвеждане на МПС', description: 'Показва страницата за въвеждане на МПС в менюто', type: 'page' },
  [PERMISSIONS.MENU_VEHICLE_LIST]: { label: 'Списък МПС', description: 'Показва страницата със списък на МПС в менюто', type: 'page' },
  [PERMISSIONS.MENU_ROLES]: { label: 'Роли', description: 'Показва страницата за управление на роли в менюто', type: 'page' },
  [PERMISSIONS.MENU_ACCOUNTS]: { label: 'Акаунти', description: 'Показва страницата за управление на акаунти в менюто', type: 'page' },
  [PERMISSIONS.MENU_AUDIT_LOGS]: { label: 'Одит лог', description: 'Показва страницата с одит записи в менюто', type: 'page' },
  [PERMISSIONS.MENU_REQUEST_CREATE]: { label: 'Заяви', description: 'Показва страницата за създаване на заявки в менюто', type: 'page' },
  [PERMISSIONS.MENU_MY_REQUESTS]: { label: 'Моите заявки', description: 'Показва страницата с моите заявки в менюто', type: 'page' },
  [PERMISSIONS.MENU_ALL_REQUESTS]: { label: 'Всички заявки', description: 'Показва страницата с всички заявки в менюто', type: 'page' },
  [PERMISSIONS.INSURANCE_READ]: { label: 'Преглед на падежи', description: 'Позволява преглед на застрахователни падежи', type: 'api', apiEndpoint: 'GET /api/insurance/expiries' },
  [PERMISSIONS.INSURANCE_MANAGE]: { label: 'Управление на падежи', description: 'Позволява добавяне, архивиране и изтриване на таблици с полици', type: 'api', apiEndpoint: 'POST /api/insurance/spreadsheets' },
  [PERMISSIONS.MENU_INSURANCE]: { label: 'Падежи', description: 'Показва страницата с падежи в менюто', type: 'page' },
  [PERMISSIONS.MENU_INSURANCE_MANAGE]: { label: 'Управление падежи', description: 'Показва страницата за управление на падежи в менюто', type: 'page' },
  [PERMISSIONS.INSURANCE_AGENT_VIEW]: { label: 'Преглед на собствени падежи', description: 'Позволява на агента да вижда своите застрахователни падежи', type: 'api', apiEndpoint: 'GET /api/insurance/by-agent/expiries' },
  [PERMISSIONS.MENU_INSURANCE_AGENTS]: { label: 'Падежи агенти', description: 'Показва страницата с падежи по агенти в менюто', type: 'page' },
  [PERMISSIONS.RESOURCE_READ]: { label: 'Преглед на ресурси', description: 'Позволява преглед на страницата с ресурси', type: 'api', apiEndpoint: 'GET /api/resources' },
  [PERMISSIONS.RESOURCE_MANAGE]: { label: 'Управление на ресурси', description: 'Позволява създаване, редактиране и изтриване на ресурси', type: 'api', apiEndpoint: 'POST /api/resources/sections' },
  [PERMISSIONS.MENU_RESOURCES]: { label: 'Ресурси', description: 'Показва страницата с ресурси в менюто', type: 'page' },
  [PERMISSIONS.MENU_NOTIFICATIONS]: { label: 'Нотификации', description: 'Показва страницата с нотификации в менюто', type: 'page' },
};
