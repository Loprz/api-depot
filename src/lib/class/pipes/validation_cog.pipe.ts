import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import { isJurisdictionCode } from '@/lib/utils/jurisdiction.utils';

@Injectable()
export class ValidationCogPipe implements PipeTransform {
  transform(value: string[]) {
    if (value) {
      for (const codeCommune of value) {
        if (!isJurisdictionCode(codeCommune)) {
          throw new BadRequestException(`Code commune ${codeCommune} invalide`);
        }
      }
    }
    return value;
  }
}
