import { PrismaService } from '../../src/prisma/prisma.service.js';
import { randomBytes } from 'crypto';

const suffix = () => randomBytes(4).toString('hex');

export async function createTestOwner(
  prisma: PrismaService,
  overrides: Record<string, unknown> = {},
) {
  const s = suffix();
  return prisma.owner.create({
    data: {
      identifier: overrides.identifier as string || `EGN${s}`,
      name: (overrides.name as string) || `Test Owner ${s}`,
      address: (overrides.address as string) || `Test Address ${s}`,
      phone: (overrides.phone as string) || undefined,
      email: (overrides.email as string) || undefined,
    },
  });
}

export async function createTestVehicle(
  prisma: PrismaService,
  createdById: string,
  overrides: Record<string, unknown> = {},
) {
  const s = suffix();
  const ownerId = (overrides.ownerId as string) ||
    (await createTestOwner(prisma)).id;

  return prisma.vehicle.create({
    data: {
      talonNumber: (overrides.talonNumber as string) || `T${s}`,
      registrationNumber: (overrides.registrationNumber as string) || `CA${s}AB`,
      engineCapacity: (overrides.engineCapacity as string) || '1600',
      powerKW: (overrides.powerKW as string) || '85',
      purpose: (overrides.purpose as string) || 'лично',
      rightHandDrive: (overrides.rightHandDrive as boolean) || false,
      notes: (overrides.notes as string) || undefined,
      ownerId,
      createdById,
    },
  });
}

export async function createTestRequest(
  prisma: PrismaService,
  agentId: string,
  overrides: Record<string, unknown> = {},
) {
  const s = suffix();
  return prisma.request.create({
    data: {
      requestType: (overrides.requestType as 'NOVA_POLICA' | 'VNOSKA') || 'NOVA_POLICA',
      status: (overrides.status as string) || 'ZAYAVENA',
      registrationNumber: (overrides.registrationNumber as string) || `CA${s}AB`,
      talonNumber: (overrides.talonNumber as string) || `T${s}`,
      engineCapacity: (overrides.engineCapacity as string) || '1600',
      powerKW: (overrides.powerKW as string) || '85',
      purpose: (overrides.purpose as string) || 'лично',
      rightHandDrive: false,
      ownerIdentifier: (overrides.ownerIdentifier as string) || `EGN${s}`,
      ownerName: (overrides.ownerName as string) || `Owner ${s}`,
      ownerAddress: (overrides.ownerAddress as string) || `Address ${s}`,
      agentId,
      ...(overrides.processedById ? { processedById: overrides.processedById as string } : {}),
    },
  });
}

/** 1x1 red pixel JPEG buffer — for file upload tests */
export const TEST_IMAGE_BUFFER = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP///////////////////' +
  '////////////////////////////////////////////2wBDAf////////' +
  '////////////////////////////////////////////////////////////' +
  'wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQ' +
  'AQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEB' +
  'AAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AKwA=',
  'base64',
);
