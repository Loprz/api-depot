import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFileContentFallback1761000000000
  implements MigrationInterface
{
  name = 'AddFileContentFallback1761000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "content" bytea`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "files" DROP COLUMN "content"`);
  }
}
