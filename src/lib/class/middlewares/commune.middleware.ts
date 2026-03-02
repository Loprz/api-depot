import {
  HttpException,
  HttpStatus,
  Injectable,
  NestMiddleware,
} from '@nestjs/common';
import { Response, NextFunction } from 'express';

import { CustomRequest } from '@/lib/types/request.type';
import { isJurisdictionCode } from '@/lib/utils/jurisdiction.utils';

@Injectable()
export class CommuneMiddleware implements NestMiddleware {
  async use(req: CustomRequest, res: Response, next: NextFunction) {
    const isValidCommuneCode =
      req.query?.ancienneCommuneAllowed === 'true'
        ? isJurisdictionCode(req.params.codeCommune)
        : isJurisdictionCode(req.params.codeCommune, { actuelle: true });

    if (!isValidCommuneCode) {
      throw new HttpException(
        `Le code commune n’existe pas`,
        HttpStatus.NOT_FOUND,
      );
    }

    req.codeCommune = req.params.codeCommune;
    next();
  }
}
