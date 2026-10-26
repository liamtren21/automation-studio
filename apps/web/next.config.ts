import type {NextConfig} from 'next';
const config:NextConfig={poweredByHeader:false,distDir:process.env.STUDIO_BUILD_DIR||'.next',serverExternalPackages:['@electric-sql/pglite','pg']};
export default config;
