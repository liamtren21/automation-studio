import type {Migration} from './runner';
export const studioRateLimits:Migration={version:14,name:'studio-http-rate-limits',sql:`CREATE TABLE studio_rate_limits(bucket_key text NOT NULL,bucket bigint NOT NULL,count integer NOT NULL DEFAULT 1,PRIMARY KEY(bucket_key,bucket));CREATE INDEX studio_rate_limits_bucket ON studio_rate_limits(bucket);`};
