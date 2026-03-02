import { Inject, Injectable, forwardRef, Logger } from '@nestjs/common';
import {
  validate,
  ValidateRowFullType,
  ValidateType,
  ErrorLevelEnum,
} from '@ban-team/validateur-bal';
import { version as validatorVersion } from '@ban-team/validateur-bal/package.json';

import { communeIsInPerimeters } from '@/lib/utils/perimeters.utils';
import { ChefDeFileService } from '@/modules/chef_de_file/chef_de_file.service';
import { RevisionService } from './revision.service';
import { Validation } from './revision.entity';
import { Client } from '../client/client.entity';
import { BanService } from '../ban/ban.service';

type ValidationProfile = 'strict' | 'us' | 'permissive';

const VALIDATION_PROFILE_VALUES: ValidationProfile[] = [
  'strict',
  'us',
  'permissive',
];

const US_PROFILE_DEFAULT_DOWNGRADED_ERRORS = [
  'row.longlat_invalides',
  'commune_insee.commune_invalide',
  'cle_interop.commune_invalide',
];

const US_PROFILE_NEVER_DOWNGRADED_ERRORS = new Set<string>([
  'commune_insee.valeur_inattendue',
  'commune_insee.out_of_perimeter',
  'rows.delete_too_many_addresses',
]);

@Injectable()
export class ValidationService {
  constructor(
    private chefDeFileService: ChefDeFileService,
    @Inject(forwardRef(() => RevisionService))
    private revisionService: RevisionService,
    private banService: BanService,
    private readonly logger: Logger,
  ) {}

  private normalizeUnique(codes: string[]): string[] {
    return [...new Set(codes)];
  }

  private getValidationProfile(): ValidationProfile {
    const rawProfile = (process.env.API_DEPOT_VALIDATION_PROFILE || '')
      .trim()
      .toLowerCase();

    if (VALIDATION_PROFILE_VALUES.includes(rawProfile as ValidationProfile)) {
      return rawProfile as ValidationProfile;
    }

    const legacyPermissive =
      process.env.API_DEPOT_PERMISSIVE_VALIDATION === '1';

    if (!rawProfile && legacyPermissive) {
      this.logger.warn(
        'API_DEPOT_PERMISSIVE_VALIDATION is deprecated, use API_DEPOT_VALIDATION_PROFILE=permissive',
        ValidationService.name,
      );
      return 'permissive';
    }

    if (rawProfile) {
      this.logger.warn(
        `Unknown API_DEPOT_VALIDATION_PROFILE='${rawProfile}', fallback to strict`,
        ValidationService.name,
      );
    }

    return 'strict';
  }

  private getUsDowngradedErrorCodes(): Set<string> {
    const configuredCodes = (
      process.env.API_DEPOT_VALIDATION_US_DOWNGRADED_ERRORS || ''
    )
      .split(',')
      .map((code) => code.trim())
      .filter(Boolean);

    return new Set([
      ...US_PROFILE_DEFAULT_DOWNGRADED_ERRORS,
      ...configuredCodes,
    ]);
  }

  private applyProfile({
    profile,
    codeCommune,
    errors,
    warnings,
    infos,
  }: {
    profile: ValidationProfile;
    codeCommune: string;
    errors: string[];
    warnings: string[];
    infos: string[];
  }) {
    const baseWarnings = this.normalizeUnique(warnings);
    const baseInfos = this.normalizeUnique(infos);

    if (profile === 'permissive' && errors.length > 0) {
      this.logger.warn(
        `Permissive validation profile enabled: forcing valid=true for commune ${codeCommune}`,
        ValidationService.name,
      );

      return {
        errors: [],
        warnings: this.normalizeUnique([...baseWarnings, ...errors]),
        infos: this.normalizeUnique([
          ...baseInfos,
          'validation.permissive_enabled',
        ]),
        downgradedErrors: this.normalizeUnique(errors),
      };
    }

    if (profile === 'us' && errors.length > 0) {
      const downgradedErrorCodes = this.getUsDowngradedErrorCodes();
      const blockingErrors: string[] = [];
      const downgradedErrors: string[] = [];

      for (const errorCode of errors) {
        if (
          downgradedErrorCodes.has(errorCode) &&
          !US_PROFILE_NEVER_DOWNGRADED_ERRORS.has(errorCode)
        ) {
          downgradedErrors.push(errorCode);
        } else {
          blockingErrors.push(errorCode);
        }
      }

      if (downgradedErrors.length > 0) {
        this.logger.warn(
          `US validation profile downgraded ${downgradedErrors.length} error(s) to warning for commune ${codeCommune}`,
          ValidationService.name,
        );
      }

      return {
        errors: this.normalizeUnique(blockingErrors),
        warnings: this.normalizeUnique([...baseWarnings, ...downgradedErrors]),
        infos: this.normalizeUnique([
          ...baseInfos,
          ...(downgradedErrors.length > 0
            ? ['validation.profile.us.downgraded_errors']
            : []),
        ]),
        downgradedErrors: this.normalizeUnique(downgradedErrors),
      };
    }

    return {
      errors: this.normalizeUnique(errors),
      warnings: baseWarnings,
      infos: baseInfos,
      downgradedErrors: [],
    };
  }

  private getRowCodeCommune(row: ValidateRowFullType): string {
    if (row.parsedValues.commune_insee) {
      return row.parsedValues.commune_insee as string;
    }

    if (row.additionalValues.cle_interop) {
      return row.additionalValues.cle_interop.codeCommune;
    }
  }

  private checkIsSameCommune(rows: ValidateRowFullType[], codeCommune: string) {
    return rows.every((r) => this.getRowCodeCommune(r) === codeCommune);
  }

  private async checkIsInPerimetre(codeCommune: string, client: Client) {
    if (client?.chefDeFileId) {
      const chefDeFile = await this.chefDeFileService.findOneOrFail(
        client.chefDeFileId,
      );
      return (
        chefDeFile.perimeters &&
        communeIsInPerimeters(codeCommune, chefDeFile.perimeters)
      );
    }

    return true;
  }

  async getLastNbRowsFromBan(codeCommune: string): Promise<number> {
    try {
      const lookup = await this.banService.getLookup(codeCommune);
      return lookup.nbNumeros || 0;
    } catch (error) {
      this.logger.error(
        "Une erreur est survenue lors de l'apelle a lookup",
        ValidationService.name,
        error,
      );
      return 0;
    }
  }

  async getLastNbRows(codeCommune: string): Promise<number> {
    try {
      const currentRevision =
        await this.revisionService.findCurrent(codeCommune);
      return currentRevision?.validation?.rowsCount || 0;
    } catch {
      return this.getLastNbRowsFromBan(codeCommune);
    }
  }

  async checkRemoveLotNumeros(
    codeCommune: string,
    rowsCount: number,
  ): Promise<boolean> {
    try {
      const currentRevision =
        await this.revisionService.findCurrent(codeCommune);

      const nbRows = currentRevision?.validation?.rowsCount || 0;
      const newNbRows = rowsCount;
      // REMOVE > 20%
      return nbRows * 0.2 < nbRows - newNbRows;
    } catch {
      return false;
    }
  }

  public async validate(
    fileData: Buffer,
    codeCommune: string,
    client: Client,
  ): Promise<Validation> {
    const profile = this.getValidationProfile();
    const { parseOk, parseErrors, profilErrors, rows } = (await validate(
      fileData,
      {
        profile: client?.isRelaxMode ? '1.3-relax' : '1.3',
      },
    )) as ValidateType;

    if (!parseOk) {
      return {
        valid: false,
        profile,
        validatorVersion,
        parseErrors,
        downgradedErrors: [],
      };
    }

    const errors: string[] = profilErrors
      .filter(({ level }) => level === ErrorLevelEnum.ERROR)
      .map(({ code }) => code);
    const warnings: string[] = profilErrors
      .filter(({ level }) => level === ErrorLevelEnum.WARNING)
      .map(({ code }) => code);
    const infos: string[] = profilErrors
      .filter(({ level }) => level === ErrorLevelEnum.INFO)
      .map(({ code }) => code);

    if (!this.checkIsSameCommune(rows, codeCommune)) {
      errors.push('commune_insee.valeur_inattendue');
    }
    if (!(await this.checkIsInPerimetre(codeCommune, client))) {
      errors.push('commune_insee.out_of_perimeter');
    }

    const rowsCount = rows.length;
    const rowsCountLast = await this.getLastNbRows(codeCommune);
    if (rowsCountLast * 0.8 < rowsCountLast - rowsCount) {
      errors.push('rows.delete_too_many_addresses');
    }

    if (rowsCountLast * 0.2 < rowsCountLast - rowsCount) {
      warnings.push('rows.delete_many_addresses');
    }

    const normalizedValidation = this.applyProfile({
      profile,
      codeCommune,
      errors,
      warnings,
      infos,
    });

    return {
      valid: normalizedValidation.errors.length === 0,
      profile,
      validatorVersion,
      errors: normalizedValidation.errors,
      warnings: normalizedValidation.warnings,
      infos: normalizedValidation.infos,
      downgradedErrors: normalizedValidation.downgradedErrors,
      rowsCount,
    };
  }
}
