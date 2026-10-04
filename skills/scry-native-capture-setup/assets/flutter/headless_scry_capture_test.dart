// Scry capture with no device (dev only). `flutter test` renders each registered screen on a 390 x 844 pt surface at
// 3x and writes <id>.png into $SCRY_OUT. It is a Flutter Material rendering, not the iOS look, and it needs
// fonts: the test host draws every glyph as a black block (Ahem) until real fonts are loaded. If they cannot be
// loaded this test fails and nothing is written, so a bundle can never be built from unreadable images.
import 'dart:io';
import 'dart:convert';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import '../integration_test/scry/screens.dart';

/// Test hook: `--dart-define=SCRY_FONTS=off` skips loading, to prove the guard below fails.
const fontsOff = String.fromEnvironment('SCRY_FONTS') == 'off';
const only = String.fromEnvironment('SCRY_SCREENS'); // comma list of ids, empty = all

/// Loads the SDK's Roboto and MaterialIcons, then every family in the app's FontManifest.json. Returns the
/// families that loaded.
Future<Set<String>> loadScryFonts() async {
  final loaded = <String>{};
  if (fontsOff) return loaded;
  final root = Platform.environment['FLUTTER_ROOT'];
  if (root != null) {
    final dir = '$root/bin/cache/artifacts/material_fonts';
    Future<ByteData?> read(String f) async {
      final file = File('$dir/$f');
      return file.existsSync() ? ByteData.sublistView(file.readAsBytesSync()) : null;
    }

    final roboto = FontLoader('Roboto');
    var robotoFiles = 0;
    for (final f in ['Roboto-Regular.ttf', 'Roboto-Medium.ttf', 'Roboto-Bold.ttf']) {
      final data = await read(f);
      if (data != null) {
        roboto.addFont(Future.value(data));
        robotoFiles++;
      }
    }
    if (robotoFiles > 0) {
      await roboto.load();
      loaded.add('Roboto');
    }
    final icons = await read('MaterialIcons-Regular.otf');
    if (icons != null) {
      await (FontLoader('MaterialIcons')..addFont(Future.value(icons))).load();
      loaded.add('MaterialIcons');
    }
  }
  try {
    final manifest = jsonDecode(await rootBundle.loadString('FontManifest.json')) as List<dynamic>;
    for (final entry in manifest) {
      final family = (entry as Map<String, dynamic>)['family'] as String;
      if (loaded.contains(family) || family == 'CupertinoIcons') continue;
      final loader = FontLoader(family);
      for (final font in entry['fonts'] as List<dynamic>) {
        loader.addFont(rootBundle.load((font as Map<String, dynamic>)['asset'] as String));
      }
      await loader.load();
      loaded.add(family);
    }
  } on FlutterError {
    // No FontManifest.json: the app declares no fonts of its own.
  }
  return loaded;
}

void main() {
  final out = Platform.environment['SCRY_OUT'] ?? 'build/scry';
  final wanted = only.isEmpty ? null : only.split(',').toSet();

  setUpAll(() async {
    final loaded = await loadScryFonts();
    // The guard: Roboto is what Material text uses here, MaterialIcons draws the icons. Without them the images
    // would be unreadable blocks, so fail now and write nothing.
    if (!loaded.contains('Roboto') || !loaded.contains('MaterialIcons')) {
      fail('scry: fonts did not load (loaded: ${loaded.isEmpty ? 'none' : loaded.join(', ')}), so the screenshots '
          'would show placeholder blocks instead of text. Run `flutter precache` so '
          '\$FLUTTER_ROOT/bin/cache/artifacts/material_fonts exists, and do not set SCRY_FONTS=off. No bundle was written.');
    }
  });

  test('scripts/screens.json lists exactly the registered screens', () {
    final listed = (jsonDecode(File('scripts/screens.json').readAsStringSync()) as List<dynamic>)
        .map((e) => (e as Map<String, dynamic>)['id'])
        .toList();
    expect(listed, scryScreens.map((s) => s.id).toList(),
        reason: 'scripts/screens.json and integration_test/scry/screens.dart must list the same ids in the same order');
  });

  for (final s in scryScreens.where((s) => wanted == null || wanted.contains(s.id))) {
    testWidgets('capture ${s.id}', (tester) async {
      tester.view.physicalSize = const Size(1170, 2532); // 390 x 844 pt at 3x
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      final key = GlobalKey();
      await tester.pumpWidget(RepaintBoundary(key: key, child: scryApp(s.build())));
      // Not pumpAndSettle: a progress indicator or looping animation never settles.
      await tester.pump(const Duration(milliseconds: 100));
      await tester.runAsync(() async {
        final boundary = key.currentContext!.findRenderObject() as RenderRepaintBoundary;
        final image = await boundary.toImage(pixelRatio: 3);
        final bytes = (await image.toByteData(format: ui.ImageByteFormat.png))!;
        Directory(out).createSync(recursive: true);
        File('$out/${s.id}.png').writeAsBytesSync(bytes.buffer.asUint8List());
      });
    });
  }
}
