import { HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { S3Service } from './s3.service';

describe('S3Service', () => {
  const originalValidationProfile = process.env.API_DEPOT_VALIDATION_PROFILE;

  afterEach(() => {
    if (originalValidationProfile === undefined) {
      delete process.env.API_DEPOT_VALIDATION_PROFILE;
    } else {
      process.env.API_DEPOT_VALIDATION_PROFILE = originalValidationProfile;
    }
  });

  it('disables S3 in local US mode when required S3 env vars are missing', async () => {
    process.env.API_DEPOT_VALIDATION_PROFILE = 'us';

    const configService = new ConfigService({
      NODE_ENV: 'development',
    });
    const service = new S3Service(configService);

    await expect(service.writeFile(Buffer.from('bal'))).rejects.toBeInstanceOf(
      HttpException,
    );

    try {
      await service.writeFile(Buffer.from('bal'));
    } catch (error) {
      expect(error.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      expect(error.getResponse()).toMatchObject({
        description: expect.stringContaining('local US-mode startup'),
      });
    }
  });
});
