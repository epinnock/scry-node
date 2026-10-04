// integration_test/scry_capture_test.dart - the device capture: one test per registered screen, run by
// `flutter drive` on an emulator or simulator (scripts/capture.sh android|ios). The PNG is written by
// test_driver/integration_test.dart on the host. Dev-only: nothing under lib/ imports this.
import 'dart:io' show Platform;

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/services.dart' show SystemChrome, SystemUiMode;
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import 'scry/screens.dart';

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  const only = String.fromEnvironment('SCRY_SCREENS'); // comma list of ids, empty = all
  final wanted = only.isEmpty ? null : only.split(',').toSet();
  for (final s in scryScreens.where((s) => wanted == null || wanted.contains(s.id))) {
    testWidgets('capture ${s.id}', (tester) async {
      // Hide the status and navigation bars so the PNG is the app only (no system chrome, no inset band).
      await SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersive);
      await tester.pump(const Duration(milliseconds: 500));
      await tester.pumpWidget(scryApp(s.build()));
      // Android renders into a SurfaceView: it must be converted to an image before a screenshot is possible.
      if (!kIsWeb && Platform.isAndroid) await binding.convertFlutterSurfaceToImage();
      await tester.pump(const Duration(milliseconds: 200));
      await binding.takeScreenshot(s.id);
    });
  }
}
