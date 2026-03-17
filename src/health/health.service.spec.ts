import { HealthService } from './health.service';

describe('HealthService', () => {
  let service: HealthService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    };
    service = new HealthService(mockPrisma);
  });

  it('returns ok when database is healthy', async () => {
    const result = await service.check();
    expect(result.status).toBe('ok');
    expect(result.database.status).toBe('ok');
    expect(result).toHaveProperty('uptime');
    expect(result).toHaveProperty('timestamp');
  });

  it('returns error when database fails', async () => {
    mockPrisma.$queryRaw.mockRejectedValue(new Error('Connection refused'));

    const result = await service.check();
    expect(result.status).toBe('error');
    expect(result.database.status).toBe('error');
    expect(result.database.message).toBe('Connection refused');
  });
});
