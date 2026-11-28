/// Manual visual review; functional assertions also run in the standard suite.
/// Run from mobile: flutter test tool/capture_ui.dart --update-goldens
library;

import '../test/screenshots/capture_test.dart' as scenarios;

void main() => scenarios.main(captureScreenshots: true);
