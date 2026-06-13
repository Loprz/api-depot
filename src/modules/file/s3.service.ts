import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  GetObjectCommandOutput,
  PutObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
import { ObjectId } from 'bson';
import { isUsValidationProfile } from '@/lib/utils/jurisdiction.utils';

const REQUIRED_S3_CONFIG_KEYS = [
  'S3_REGION',
  'S3_ENDPOINT',
  'S3_CONTAINER_ID',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
];

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly s3Client: S3Client | null;
  private readonly missingConfigKeys: string[];
  private readonly localUsModeBypass: boolean;

  constructor(private configService: ConfigService) {
    this.missingConfigKeys = REQUIRED_S3_CONFIG_KEYS.filter((key) => {
      const value = this.configService.get<string>(key);
      return !value || value.trim() === '';
    });

    const nodeEnv = (this.configService.get<string>('NODE_ENV') || '')
      .trim()
      .toLowerCase();
    const isLocalLike = nodeEnv !== 'production';

    this.localUsModeBypass =
      isLocalLike &&
      isUsValidationProfile() &&
      this.missingConfigKeys.length > 0;

    if (this.localUsModeBypass) {
      this.logger.warn(
        `Local US-mode startup without complete S3 config (${this.missingConfigKeys.join(
          ', ',
        )}); new BAL files will use database fallback storage instead.`,
      );
      this.s3Client = null;
      return;
    }

    if (this.missingConfigKeys.length > 0) {
      this.logger.warn(
        `S3 configuration is incomplete (${this.missingConfigKeys.join(
          ', ',
        )}); S3-backed file storage may fail until these env vars are set.`,
      );
    }

    this.s3Client = new S3Client({
      region: this.configService.get<string>('S3_REGION'),
      credentials: {
        accessKeyId: this.configService.get<string>('S3_ACCESS_KEY'),
        secretAccessKey: this.configService.get<string>('S3_SECRET_KEY'),
      },
      endpoint: this.configService.get<string>('S3_ENDPOINT'),
    });
  }

  private getErrorDescription(error: unknown): string {
    if (error instanceof HttpException) {
      const response = error.getResponse();

      if (
        typeof response === 'object' &&
        response !== null &&
        'description' in response &&
        typeof response.description === 'string'
      ) {
        return response.description;
      }
    }

    if (error instanceof Error) {
      return error.message;
    }

    return 'Unknown S3 error';
  }

  private getS3Client(): S3Client {
    if (this.s3Client) {
      return this.s3Client;
    }

    const description = this.localUsModeBypass
      ? 'S3 is disabled for local US-mode startup because required S3 env vars are missing; new uploads should use database fallback storage instead.'
      : `S3 is not configured. Missing env vars: ${this.missingConfigKeys.join(
          ', ',
        )}`;

    throw new HttpException(
      {
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'S3 storage unavailable',
        description,
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  private async readStream(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    return new Promise<Buffer>((resolve, reject) => {
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('error', (err) => reject(err));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  private async getS3File(fileId): Promise<Buffer> {
    const s3Client = this.getS3Client();
    const { Body }: GetObjectCommandOutput = await s3Client.send(
      new GetObjectCommand({
        Bucket: this.configService.get<string>('S3_CONTAINER_ID'),
        Key: fileId,
      }),
    );

    return this.readStream(Body as Readable);
  }

  private async uploadS3File(
    fileId: string,
    data: Buffer,
  ): Promise<PutObjectCommandOutput> {
    const s3Client = this.getS3Client();
    return s3Client.send(
      new PutObjectCommand({
        Bucket: this.configService.get<string>('S3_CONTAINER_ID'),
        Key: fileId,
        Body: data,
      }),
    );
  }

  public async writeFile(buffer: Buffer): Promise<string> {
    try {
      const fileId = new ObjectId().toHexString();
      await this.uploadS3File(fileId, buffer);
      return fileId;
    } catch (error) {
      throw new HttpException(
        {
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          message: 'Fichier non uploadé sur S3',
          description: this.getErrorDescription(error),
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  public async getFile(fileId: string): Promise<Buffer> {
    try {
      const file = await this.getS3File(fileId);
      return file;
    } catch (error) {
      throw new HttpException(
        {
          statusCode: HttpStatus.NOT_FOUND,
          message: 'Fichier non trouvé sur S3',
          description: this.getErrorDescription(error),
        },
        HttpStatus.NOT_FOUND,
      );
    }
  }
}
