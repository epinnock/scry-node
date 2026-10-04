// Scry capture on a simulator or emulator (dev only). Run through `bash scripts/capture.sh android|ios`, which
// calls `flutter drive` with test_driver/integration_test.dart. One run takes one screenshot per registered screen.
// The image is the app surface only (no status bar or navigation bar).
import 'dart:io' show Platform;

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import 'scry/screens.dart';

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  const only = String.fromEnvironment('SCRY_SCREENS'); // comma list of ids, empty = all
  final wanted = only.isEmpty ? null : only.split(',').toSet();
  for (final s in scryScreens.where((s) => wanted == null || wanted.contains(s.id))) {
    testWidgets('capture ${s.id}', (tester) async {
      await tester.pumpWidget(scryApp(s.build()));
      // Android needs the surface converted to an image once before the first screenshot, or the frame is blank.
      if (!kIsWeb && Platform.isAndroid) await binding.convertFlutterSurfaceToImage();
      // Not pumpAndSettle: a progress indicator or looping animation never settles.
      await tester.pump(const Duration(milliseconds: 200));
      await binding.takeScreenshot(s.id);
    });
  }
}
