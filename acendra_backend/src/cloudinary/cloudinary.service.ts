import {
  Injectable,
  InternalServerErrorException,
  OnModuleInit,
} from '@nestjs/common';

import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';

import { Readable } from 'node:stream';

export type CloudinaryResourceType =
  | 'image'
  | 'video'
  | 'raw';

export interface CloudinaryUploadResult {
  publicId: string;
  secureUrl: string;
  resourceType: string;
  format: string;
  bytes: number;
}

@Injectable()
export class CloudinaryService implements OnModuleInit {
  constructor(
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    cloudinary.config({
      cloud_name:
        this.configService.getOrThrow<string>(
          'CLOUDINARY_CLOUD_NAME',
        ),
      api_key:
        this.configService.getOrThrow<string>(
          'CLOUDINARY_API_KEY',
        ),
      api_secret:
        this.configService.getOrThrow<string>(
          'CLOUDINARY_API_SECRET',
        ),
      secure: true,
    });
  }

  async uploadBuffer(
    buffer: Buffer,
    options: {
      folder: string;
      resourceType: CloudinaryResourceType;
      publicId: string;
      originalFilename: string;
    },
  ): Promise<CloudinaryUploadResult> {
    try {
      const result = await new Promise<any>(
        (resolve, reject) => {
          const uploadStream =
            cloudinary.uploader.upload_stream(
              {
                folder: options.folder,
                resource_type: options.resourceType,
                public_id: options.publicId,
                use_filename: false,
                unique_filename: false,
                overwrite: false,

                // Keep this as a server-side upload setting.
                // For private documents, configure an appropriate
                // authenticated delivery strategy separately.
              },
              (error, uploadResult) => {
                if (error || !uploadResult) {
                  reject(
                    error ??
                      new Error(
                        'Cloudinary upload returned no result.',
                      ),
                  );
                  return;
                }

                resolve(uploadResult);
              },
            );

          Readable.from(buffer).pipe(uploadStream);
        },
      );

      return {
        publicId: result.public_id,
        secureUrl: result.secure_url,
        resourceType: result.resource_type,
        format: result.format ?? '',
        bytes: result.bytes,
      };
    } catch {
      throw new InternalServerErrorException(
        'Unable to upload the attachment.',
      );
    }
  }

  async deleteAsset(
    publicId: string,
    resourceType: CloudinaryResourceType,
  ) {
    return cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
      invalidate: true,
    });
  }
}