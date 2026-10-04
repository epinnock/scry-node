// test/scry_capture_test.dart - the headless capture (no device): renders each registered screen with
// RenderRepaintBoundary.toImage on a 390 x 844 surface at 3x and writes $SCRY_OUT/<id>.png.
// Run through `bash scripts/capture.sh headless`. This is the Flutter Material look, rendered on the host.
// It fails, and writes nothing, when the fonts did not load (test/scry_fonts.dart).
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

import '../integration_test/scry/screens.dart';
import 'scry_fonts.dart';

void main() {
  final out = Platform.environment['SCRY_OUT'] ?? 'build/scry';
  var fontsReady = false;
  setUpAll(() async {
    await loadScryFonts(); // throws ScryFontsNotLoaded with a plain-language message
    fontsReady = true;
  });

  // Runs before any capture: every font a registered screen draws with (theme default and explicit families) must be
  // readable, otherwise the run fails here and no screenshot is written.
  testWidgets('every registered screen draws with fonts that loaded', (tester) async {
    expect(fontsReady, isTrue, reason: 'fonts did not load: refusing to write a screenshot');
    for (final s in scryScreens) {
      await tester.pumpWidget(scryApp(s.build()));
      await assertScryScreenFontsReadable(tester, s.id);
    }
  });

  for (final s in scryScreens) {
    testWidgets('capture ${s.id}', (tester) async {
      expect(fontsReady, isTrue, reason: 'fonts did not load: refusing to write a screenshot');
      tester.view.physicalSize = const Size(1170, 2532); // 390 x 844 pt at 3x
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      final key = GlobalKey();
      await tester.pumpWidget(RepaintBoundary(key: key, child: scryApp(s.build())));
      await tester.pump(const Duration(milliseconds: 100));
      await tester.runAsync(() async {
        final boundary = key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
        final image = await boundary.toImage(pixelRatio: 3);
        final bytes = (await image.toByteData(format: ui.ImageByteFormat.png))!;
        Directory(out).createSync(recursive: true);
        File('$out/${s.id}.png').writeAsBytesSync(bytes.buffer.asUint8List());
      });
    });
  }
}
