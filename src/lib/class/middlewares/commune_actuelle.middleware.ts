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
export class CommuneActuelleMiddleware implements NestMiddleware {
  async use(req: CustomRequest, res: Response, next: NextFunction) {
    if (!isJurisdictionCode(req.params.codeCommune, { actuelle: true })) {
      throw new HttpException(
        `Le code commune n'existe pas`,
        HttpStatus.NOT_FOUND,
      );
    }

    req.codeCommune = req.params.codeCommune;
    next();
  }
}
