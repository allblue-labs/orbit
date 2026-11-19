import {
  androidAppAssociation,
  mobileAssociationResponse,
} from "@/server/mobile-app-association";

export function GET() {
  return mobileAssociationResponse(
    androidAppAssociation(process.env.ORBIT_ANDROID_APP_LINK_SHA256),
  );
}
