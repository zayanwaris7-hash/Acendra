
import { registerAs } from '@nestjs/config';

export default registerAs('typeorm', () => {
  const url = process.env.DATABASE_URL;
  const synchronize = process.env.DB_SYNCHRONIZE === 'true';

  console.log('🔧 Loading TypeORM configuration...');
  console.log('🗄️ Database type: PostgreSQL');
  console.log('🌐 Database provider: Neon PostgreSQL');
  console.log('🔑 DATABASE_URL configured:', Boolean(url));
  console.log('🔄 Schema synchronization:', synchronize);

  return {
    type: 'postgres' as const,
    url,

    autoLoadEntities: true,
    synchronize,

    retryAttempts: 5,
    retryDelay: 3000,

    logging: false,

    extra: {
      max: Number(process.env.DATABASE_POOL_MAX) || 10,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
    },
  };
});
