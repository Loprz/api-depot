import { HttpException, HttpStatus, Logger } from '@nestjs/common';

import { FileService } from './file.service';
import { File, TypeFileEnum } from './file.entity';

describe('FileService', () => {
  it('stores BAL content in the database when S3 is unavailable', async () => {
    const create = jest.fn((entity: Partial<File>) => entity as File);
    const save = jest.fn(async (entity: File) => entity);
    const repository = {
      create,
      save,
    };
    const s3Service = {
      writeFile: jest
        .fn()
        .mockRejectedValue(
          new HttpException(
            'S3 storage unavailable',
            HttpStatus.SERVICE_UNAVAILABLE,
          ),
        ),
    };
    const logger = {
      debug: jest.fn(),
      warn: jest.fn(),
    } as unknown as Logger;

    const service = new FileService(
      repository as any,
      s3Service as any,
      logger,
    );
    const fileData = Buffer.from('bal-file');

    const savedFile = await service.createOne('revision-1', fileData);

    expect(s3Service.writeFile).toHaveBeenCalledWith(fileData);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        revisionId: 'revision-1',
        type: TypeFileEnum.BAL,
        size: fileData.length,
        content: fileData,
      }),
    );
    expect(savedFile.content).toEqual(fileData);
    expect(savedFile.id).toHaveLength(24);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
