import { ApiProperty } from '@nestjs/swagger';

export class ValidationTelemetryWindowDTO {
  @ApiProperty()
  from: string;

  @ApiProperty()
  to: string;
}

export class ValidationProfileCountsDTO {
  @ApiProperty()
  strict: number;

  @ApiProperty()
  us: number;

  @ApiProperty()
  permissive: number;

  @ApiProperty()
  unknown: number;
}

export class DowngradedErrorCountDTO {
  @ApiProperty()
  code: string;

  @ApiProperty()
  count: number;
}

export class ValidationTelemetryDTO {
  @ApiProperty({ type: () => ValidationTelemetryWindowDTO })
  window: ValidationTelemetryWindowDTO;

  @ApiProperty()
  publishedRevisions: number;

  @ApiProperty()
  revisionsWithValidation: number;

  @ApiProperty()
  revisionsWithDowngradedErrors: number;

  @ApiProperty({ type: () => ValidationProfileCountsDTO })
  profileCounts: ValidationProfileCountsDTO;

  @ApiProperty({ type: () => DowngradedErrorCountDTO, isArray: true })
  topDowngradedErrors: DowngradedErrorCountDTO[];
}
