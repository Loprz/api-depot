import { Injectable } from '@nestjs/common';
import {
  add,
  eachDayOfInterval,
  endOfDay,
  format,
  compareDesc,
  subYears,
  subMonths,
  subWeeks,
} from 'date-fns';
import { keyBy, groupBy, mapValues } from 'lodash';

import { DateFromToQueryTransformed } from '@/lib/class/pipes/date_from_to.pipe';
import { RevisionService } from '@/modules/revision/revision.service';
import {
  Revision,
  StatusRevisionEnum,
} from '@/modules/revision/revision.entity';
import { ClientService } from '@/modules/client/client.service';
import { FirstPublicationDTO } from './dto/first_pulication.dto';
import { PublicationDTO } from './dto/publication.dto';
import { Client } from '../client/client.entity';
import { Between, In } from 'typeorm';
import { MetricsIncubateurDTO } from './dto/metrics_incubateur.dto';
import {
  ValidationTelemetryDTO,
  ValidationTelemetryTimeseriesDTO,
  ValidationTelemetryTimeseriesPointDTO,
} from './dto/validation_telemetry.dto';

const CLIENTS_TO_MONITOR = {
  mesAdresses: 'mes-adresses',
  moissonneur: 'moissonneur-bal',
};

type ValidationProfileKey = 'strict' | 'us' | 'permissive' | 'unknown';
type ValidationProfileCounts = Record<ValidationProfileKey, number>;

export interface RevisionLast {
  codeCommune: string;
  publishedAt: Date;
  totalCount: number;
}

export interface RevisionAgg {
  codeCommune: string;
  publishedAt: Date;
  clientId: string;
}

@Injectable()
export class StatService {
  clientsToMonitorIndex = [];
  constructor(
    private revisionService: RevisionService,
    private clientService: ClientService,
  ) {
    this.initClients();
  }

  private normalizeWindow(dates: DateFromToQueryTransformed) {
    return dates.from.getTime() <= dates.to.getTime()
      ? { from: dates.from, to: dates.to }
      : { from: dates.to, to: dates.from };
  }

  private getEmptyProfileCounts(): ValidationProfileCounts {
    return {
      strict: 0,
      us: 0,
      permissive: 0,
      unknown: 0,
    };
  }

  private getNormalizedProfile(
    profile: string | undefined,
  ): ValidationProfileKey {
    return profile === 'strict' ||
      profile === 'us' ||
      profile === 'permissive' ||
      profile === 'unknown'
      ? profile
      : 'unknown';
  }

  private getUniqueDowngradedErrors(revision: Revision): string[] {
    return [...new Set(revision.validation?.downgradedErrors || [])];
  }

  private getEmptyTimeseriesPoint(
    date: string,
  ): ValidationTelemetryTimeseriesPointDTO {
    return {
      date,
      publishedRevisions: 0,
      revisionsWithValidation: 0,
      revisionsWithDowngradedErrors: 0,
      profileCounts: this.getEmptyProfileCounts(),
      downgradedErrorCounts: {},
    };
  }

  private async initClients() {
    try {
      const clientsToMonitor: Client[] = await this.clientService.findMany({
        legacyId: In(Object.values(CLIENTS_TO_MONITOR)),
      });
      this.clientsToMonitorIndex = keyBy(clientsToMonitor, 'id');
    } catch {
      // Table may not exist yet (migrations not run); keep app up for depot routes
      this.clientsToMonitorIndex = keyBy([], 'id');
    }
  }

  public async findFirstPublications(
    dates: DateFromToQueryTransformed,
  ): Promise<FirstPublicationDTO[]> {
    const revisionAgg: RevisionAgg[] = await this.revisionService.findFirsts();
    const cumulFirstRevisionsByDate: FirstPublicationDTO[] = [];
    for (
      let dateIterator = endOfDay(new Date(dates.from.getTime()));
      compareDesc(dateIterator, endOfDay(dates.to)) >= 0;
      dateIterator = add(dateIterator, { days: 1 })
    ) {
      const dailyCreations = revisionAgg.filter(
        ({ publishedAt }) => compareDesc(publishedAt, dateIterator) === 1,
      );
      cumulFirstRevisionsByDate.push({
        date: format(dateIterator, 'yyyy-MM-dd'),
        totalCreations: dailyCreations.length,
        viaMesAdresses: dailyCreations.filter(
          ({ clientId }) =>
            this.clientsToMonitorIndex[clientId]?.legacyId ===
            CLIENTS_TO_MONITOR.mesAdresses,
        ).length,
        viaMoissonneur: dailyCreations.filter(
          ({ clientId }) =>
            this.clientsToMonitorIndex[clientId]?.legacyId ===
            CLIENTS_TO_MONITOR.moissonneur,
        ).length,
      });
    }

    return cumulFirstRevisionsByDate;
  }

  public async findPublications(
    dates: DateFromToQueryTransformed,
  ): Promise<PublicationDTO[]> {
    const revisions: Revision[] = await this.revisionService.findMany({
      publishedAt: Between(dates.from, dates.to),
    });

    const revisionsGroupByDays = groupBy(revisions, (revision) =>
      format(revision.publishedAt, 'yyyy-MM-dd'),
    );
    return Object.entries(revisionsGroupByDays).map(([date, revisions]) => {
      const revisionsGroupByBals = groupBy(
        revisions,
        (revision) => revision.codeCommune,
      );
      return {
        date,
        publishedBAL: mapValues(revisionsGroupByBals, (revisionsByBal) => ({
          total: revisionsByBal.length,
          viaMesAdresses: revisionsByBal.filter(
            ({ client }) =>
              this.clientsToMonitorIndex[client]?.id ===
              CLIENTS_TO_MONITOR.mesAdresses,
          ).length,
          viaMoissonneur: revisionsByBal.filter(
            ({ client }) =>
              this.clientsToMonitorIndex[client]?.id ===
              CLIENTS_TO_MONITOR.moissonneur,
          ).length,
        })),
      };
    });
  }

  public async metricsIncubateur(
    offset?: number,
    limit?: number,
  ): Promise<MetricsIncubateurDTO> {
    const revisions: RevisionLast[] = await this.revisionService.findLasts({
      offset,
      limit,
    });
    const now = new Date();
    return {
      count: Number(revisions[0]?.totalCount) || 0,
      results: revisions.map((revision) => ({
        insee: revision.codeCommune,
        metrics: {
          tu: 1,
          yau: subYears(now, 1) <= revision.publishedAt ? 1 : 0,
          mau: subMonths(now, 1) <= revision.publishedAt ? 1 : 0,
          wau: subWeeks(now, 1) <= revision.publishedAt ? 1 : 0,
        },
      })),
    };
  }

  private inferLegacyProfile(revision: Revision) {
    const infos = revision.validation?.infos || [];

    if (infos.includes('validation.permissive_enabled')) {
      return 'permissive';
    }

    if (infos.includes('validation.profile.us.downgraded_errors')) {
      return 'us';
    }

    return 'unknown';
  }

  public async findValidationTelemetry(
    dates: DateFromToQueryTransformed,
    top = 10,
  ): Promise<ValidationTelemetryDTO> {
    const safeTop = Math.max(1, top);
    const window = this.normalizeWindow(dates);

    const revisions = await this.revisionService.findMany({
      publishedAt: Between(window.from, window.to),
      status: StatusRevisionEnum.PUBLISHED,
    });

    const profileCounts = this.getEmptyProfileCounts();

    const downgradedErrorCountByCode: Record<string, number> = {};
    let revisionsWithValidation = 0;
    let revisionsWithDowngradedErrors = 0;

    for (const revision of revisions) {
      const validation = revision.validation;

      if (!validation) {
        profileCounts.unknown += 1;
        continue;
      }

      revisionsWithValidation += 1;

      const profile = validation.profile || this.inferLegacyProfile(revision);
      const normalizedProfile = this.getNormalizedProfile(profile);
      profileCounts[normalizedProfile] += 1;

      const downgradedErrors = this.getUniqueDowngradedErrors(revision);
      if (downgradedErrors.length > 0) {
        revisionsWithDowngradedErrors += 1;
      }

      for (const errorCode of downgradedErrors) {
        downgradedErrorCountByCode[errorCode] =
          (downgradedErrorCountByCode[errorCode] || 0) + 1;
      }
    }

    const topDowngradedErrors = Object.entries(downgradedErrorCountByCode)
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
      .slice(0, safeTop);

    return {
      window: {
        from: format(window.from, 'yyyy-MM-dd'),
        to: format(window.to, 'yyyy-MM-dd'),
      },
      publishedRevisions: revisions.length,
      revisionsWithValidation,
      revisionsWithDowngradedErrors,
      profileCounts,
      topDowngradedErrors,
    };
  }

  public async findValidationTelemetryTimeseries(
    dates: DateFromToQueryTransformed,
    top = 10,
  ): Promise<ValidationTelemetryTimeseriesDTO> {
    const safeTop = Math.max(1, top);
    const window = this.normalizeWindow(dates);

    const revisions = await this.revisionService.findMany({
      publishedAt: Between(window.from, window.to),
      status: StatusRevisionEnum.PUBLISHED,
    });

    const dateKeys = eachDayOfInterval({
      start: window.from,
      end: window.to,
    }).map((date) => format(date, 'yyyy-MM-dd'));

    const pointsByDate = Object.fromEntries(
      dateKeys.map((date) => [date, this.getEmptyTimeseriesPoint(date)]),
    );

    const downgradedErrorCountByCode: Record<string, number> = {};

    for (const revision of revisions) {
      const pointDate = format(revision.publishedAt, 'yyyy-MM-dd');
      const point =
        pointsByDate[pointDate] || this.getEmptyTimeseriesPoint(pointDate);

      if (!pointsByDate[pointDate]) {
        pointsByDate[pointDate] = point;
      }

      point.publishedRevisions += 1;

      if (!revision.validation) {
        point.profileCounts.unknown += 1;
        continue;
      }

      point.revisionsWithValidation += 1;

      const profile = this.getNormalizedProfile(
        revision.validation.profile || this.inferLegacyProfile(revision),
      );
      point.profileCounts[profile] += 1;

      const downgradedErrors = this.getUniqueDowngradedErrors(revision);
      if (downgradedErrors.length > 0) {
        point.revisionsWithDowngradedErrors += 1;
      }

      for (const errorCode of downgradedErrors) {
        point.downgradedErrorCounts[errorCode] =
          (point.downgradedErrorCounts[errorCode] || 0) + 1;
        downgradedErrorCountByCode[errorCode] =
          (downgradedErrorCountByCode[errorCode] || 0) + 1;
      }
    }

    const topCodes = Object.entries(downgradedErrorCountByCode)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, safeTop)
      .map(([code]) => code);

    const points: ValidationTelemetryTimeseriesPointDTO[] = Object.values(
      pointsByDate,
    )
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((point) => ({
        ...point,
        downgradedErrorCounts: Object.fromEntries(
          topCodes.map((code) => [
            code,
            point.downgradedErrorCounts[code] || 0,
          ]),
        ),
      }));

    return {
      window: {
        from: format(window.from, 'yyyy-MM-dd'),
        to: format(window.to, 'yyyy-MM-dd'),
      },
      topCodes,
      points,
    };
  }
}
