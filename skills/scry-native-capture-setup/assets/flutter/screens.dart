// Scry capture registry (dev only). Lives under integration_test/, so nothing in lib/ imports it and a
// release build cannot contain it. One entry per screen to capture; fixtures are closed over in `build`
// so two captures are identical (fixed clock, constant data, no network, no plugins, no randomness).
import 'package:flutter/material.dart';
// TODO: import the app's own screens, e.g. import 'package:my_app/screens/menu_screen.dart';

class ScryScreen {
  const ScryScreen(this.id, this.name, this.kind, this.file, this.line, this.build);

  /// Stable across builds: a route or type name, never a display title. Letters, digits, `.`, `_`, `-`.
  final String id;
  final String name;

  /// `screen`, or `component` (captured on a full-screen canvas, not a tight crop).
  final String kind;

  /// Source file and line of the widget, relative to the project root (checked by hand: they drift).
  final String file;
  final int line;
  final Widget Function() build;
}

/// The app shell every capture is pumped into: the app's own theme, locale and text scale, no debug
/// banner. Use the same theme as the real app, or the screenshots will not look like it.
Widget scryApp(Widget screen) => MaterialApp(
      debugShowCheckedModeBanner: false,
      // theme: appTheme,  // TODO: the app's own ThemeData
      home: screen,
    );

// Keep scripts/screens.json in step with this list: same ids, same order. The headless test fails if they differ.
final scryScreens = <ScryScreen>[
  ScryScreen('home', 'Home', 'screen', 'lib/main.dart', 1,
      () => const Scaffold(body: Center(child: Text('Replace me with a real screen')))),
];
