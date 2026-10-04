// test/scry_fonts.dart - loads real fonts into `flutter test` (which draws every glyph as a black Ahem square by default)
// and refuses to continue when they did not load. Dev-only helper for test/scry_capture_test.dart.
//   1. Roboto and MaterialIcons from the Flutter SDK ($FLUTTER_ROOT/bin/cache/artifacts/material_fonts)
//   2. every family the app declares in its FontManifest.json (read through rootBundle), package fonts included
//      (`packages/<pkg>/<family>` entries are loaded under that same name, which is what `package:` text styles resolve to)
//   3. assertScryScreenFontsReadable: every family a registered screen's theme or text actually draws with is probed, so
//      a family that is not bundled (flutter_test renders it as Ahem blocks) fails the run instead of uploading boxes.
// SCRY_NO_FONTS=1 skips the loading on purpose, to prove the guard (the run must then fail and write nothing).
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// Thrown when the fonts needed for a readable capture are not available. The message is meant for a person.
class ScryFontsNotLoaded implements Exception {
  ScryFontsNotLoaded(this.problems);
  final List<String> problems;

  @override
  String toString() =>
      'scry capture: fonts did not load, so screenshots would show black Ahem blocks instead of text. '
      'No screenshots were written and no bundle was made.\n  - ${problems.join('\n  - ')}\n'
      'Fix: run with a complete Flutter SDK (FLUTTER_ROOT with bin/cache/artifacts/material_fonts) and declare your '
      "app's fonts (and any package's) under `fonts:` in pubspec.yaml. A monospace font can be refused although it loaded "
      '(all its letters are equally wide): see the docs troubleshooting entry.';
}

const _iconFamilies = {'MaterialIcons', 'CupertinoIcons'};

/// Icon fonts (also as `packages/<pkg>/<family>`): their glyphs are not letters, so they are neither probed nor loaded here.
bool _isIconFamily(String family) => _iconFamilies.contains(family.split('/').last);

Future<void> loadScryFonts() async {
  if (Platform.environment['SCRY_NO_FONTS'] == '1') {
    await assertScryFontsReadable(const ['Roboto']);
    return;
  }
  final problems = <String>[];
  final families = <String>{'Roboto'};

  final root = Platform.environment['FLUTTER_ROOT'];
  if (root == null || root.isEmpty) {
    problems.add('FLUTTER_ROOT is not set, so the SDK fonts (Roboto, MaterialIcons) cannot be found');
  } else {
    final dir = '$root/bin/cache/artifacts/material_fonts';
    Future<void> sdkFont(String family, List<String> files) async {
      final loader = FontLoader(family);
      for (final f in files) {
        final file = File('$dir/$f');
        if (!file.existsSync()) {
          problems.add('SDK font file missing: $dir/$f');
          return;
        }
        loader.addFont(Future.value(ByteData.sublistView(file.readAsBytesSync())));
      }
      await loader.load();
    }

    await sdkFont('Roboto', ['Roboto-Regular.ttf', 'Roboto-Medium.ttf', 'Roboto-Bold.ttf']);
    await sdkFont('MaterialIcons', ['MaterialIcons-Regular.otf']);
  }

  families.addAll(await loadScryManifestFonts(rootBundle, problems));

  if (problems.isNotEmpty) throw ScryFontsNotLoaded(problems);
  await assertScryFontsReadable(families);
}

/// Loads every family in the bundle's FontManifest.json (the app's own and `packages/<pkg>/<family>` entries, icon fonts
/// excepted) and returns the family names. A manifest that cannot be read is added to [problems].
Future<Set<String>> loadScryManifestFonts(AssetBundle bundle, List<String> problems) async {
  final families = <String>{};
  try {
    final manifest = jsonDecode(await bundle.loadString('FontManifest.json')) as List<dynamic>;
    for (final entry in manifest.cast<Map<String, dynamic>>()) {
      final family = entry['family'] as String;
      if (_isIconFamily(family)) continue;
      final loader = FontLoader(family);
      for (final font in (entry['fonts'] as List<dynamic>).cast<Map<String, dynamic>>()) {
        loader.addFont(bundle.load(font['asset'] as String));
      }
      await loader.load();
      families.add(family);
    }
  } on Object catch (e) {
    problems.add("the app's FontManifest.json could not be read ($e)");
  }
  return families;
}

/// Ahem draws every glyph as a 1 em square, so "iiii" and "WWWW" measure the same. A real font does not.
/// Monospace families also measure the same (a correctly loaded one is then refused: fail closed, see the docs
/// troubleshooting entry), and icon families are skipped. [usedBy] names the screen in the message.
Future<void> assertScryFontsReadable(Iterable<String> families, {String? usedBy}) async {
  final placeholders = <String>[];
  for (final family in families.toSet()) {
    if (_isIconFamily(family)) continue;
    double width(String text) {
      final p = TextPainter(
        text: TextSpan(
          text: text,
          style: TextStyle(fontFamily: family, fontSize: 40),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      return p.width;
    }

    if ((width('iiii') - width('WWWW')).abs() < 0.5) {
      placeholders.add(
        "$family${usedBy == null ? '' : ' (used by $usedBy)'} renders as placeholder blocks (Ahem): "
        'it is not bundled in this app, or its package font is not declared',
      );
    }
  }
  if (placeholders.isNotEmpty) throw ScryFontsNotLoaded(placeholders);
}

/// The font families a pumped screen draws with: the root style of every RichText (Text resolves theme and
/// DefaultTextStyle into it, so this covers the ThemeData default family and any explicit `fontFamily`) plus the
/// families set on the app theme's text styles. Call after `pumpWidget`.
Set<String> scryFontFamiliesUsed(WidgetTester tester) {
  final families = <String>{};
  void addFrom(TextStyle? style) {
    final family = style?.fontFamily;
    if (family != null && family.isNotEmpty) families.add(family);
  }

  void walk(InlineSpan span) {
    if (span is TextSpan) {
      addFrom(span.style);
      span.children?.forEach(walk);
    }
  }

  for (final rich in tester.widgetList<RichText>(find.byType(RichText))) {
    walk(rich.text);
  }
  for (final app in tester.widgetList<MaterialApp>(find.byType(MaterialApp))) {
    final t = app.theme?.textTheme;
    if (t == null) continue;
    for (final style in [
      t.displayLarge,
      t.displayMedium,
      t.displaySmall,
      t.headlineLarge,
      t.headlineMedium,
      t.headlineSmall,
      t.titleLarge,
      t.titleMedium,
      t.titleSmall,
      t.bodyLarge,
      t.bodyMedium,
      t.bodySmall,
      t.labelLarge,
      t.labelMedium,
      t.labelSmall,
    ]) {
      addFrom(style);
    }
  }
  return families;
}

/// Fails (ScryFontsNotLoaded) when a family the screen draws with is not readable. Call after `pumpWidget`.
Future<void> assertScryScreenFontsReadable(WidgetTester tester, String screenId) =>
    assertScryFontsReadable(scryFontFamiliesUsed(tester), usedBy: screenId);
