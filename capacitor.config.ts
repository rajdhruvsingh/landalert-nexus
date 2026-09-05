import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'in.gov.landalert.nexus',
  appName: 'LandAlert-Nexus',
  webDir: '.output/public',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    Camera: {
      permissionsType: 'prompt',
    },
    Geolocation: {
      permissionsType: 'prompt',
    },
  },
};

export default config;
