import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import * as hasha from 'hasha';
import { ObjectId } from 'bson';

import { S3Service } from './s3.service';
import { File, TypeFileEnum } from './file.entity';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class FileService {
  constructor(
    @InjectRepository(File)
    private fileRepository: Repository<File>,
    private s3Service: S3Service,
    private readonly logger: Logger,
  ) {}

  public async createOne(revisionId: string, fileData: Buffer): Promise<File> {
    const now = Date.now();
    this.logger.debug(
      `START UPLOAD FILE S3 for ${revisionId}, size ${Buffer.byteLength(fileData)} at ${new Date(now).toDateString()}`,
    );
    let id: string;
    let content: Buffer | null = null;

    try {
      id = await this.s3Service.writeFile(fileData);
    } catch (error) {
      // Fallback to database storage when S3 is not configured/unavailable.
      id = new ObjectId().toHexString();
      content = fileData;
      this.logger.warn(
        `S3 upload unavailable for revision ${revisionId}, storing BAL file in database`,
        FileService.name,
      );
    }

    this.logger.debug(
      `END UPLOAD FILE S3 for ${revisionId} in ${Date.now() - now}`,
    );
    const entityToSave: File = this.fileRepository.create({
      id,
      revisionId,
      type: TypeFileEnum.BAL,
      size: fileData.length,
      hash: hasha(fileData, { algorithm: 'sha256' }),
      content,
    });
    return this.fileRepository.save(entityToSave);
  }

  public async findOneByRevision(revisionId: string): Promise<File> {
    return this.fileRepository.findOne({
      where: { revisionId, type: TypeFileEnum.BAL },
    });
  }

  public async findDataByRevision(revisionId: string): Promise<Buffer> {
    const file: File = await this.findOneByRevision(revisionId);

    if (!file) {
      throw new HttpException(
        `Aucun fichier de type 'bal' associé à la révision ${revisionId}`,
        HttpStatus.NOT_FOUND,
      );
    }

    if (file.content) {
      return Buffer.from(file.content);
    }

    const data: Buffer = await this.s3Service.getFile(file.id);
    return Buffer.from(data);
  }
}
