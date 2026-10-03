// ScryScreens.swift - the registry: one entry per screen or component you want mapped in Scry.
// `id` is the stable identity across builds: never derive it from a title a human may edit.
// `file` and `line` point at the view's declaration (KettleTests checks that they do).
#if DEBUG
import SwiftUI

struct ScryScreen {
    let id: String
    let name: String
    let kind: String          // "screen" or "component"
    let title: [String]       // grouping shown in Scry, e.g. ["Screens"]
    let file: String          // path of the view's source file, relative to the repo root
    let line: Int             // line of the view's declaration
    let view: AnyView
}

enum ScryScreens {
    static let all: [ScryScreen] = [
        ScryScreen(id: "menu", name: "Menu", kind: "screen", title: ["Screens"],
                   file: "Kettle/Screens/MenuView.swift", line: 3,
                   view: AnyView(MenuView(drinks: Fixtures.drinks, itemCount: Fixtures.order.itemCount))),
        ScryScreen(id: "item-detail", name: "Item Detail", kind: "screen", title: ["Screens"],
                   file: "Kettle/Screens/ItemDetailView.swift", line: 3,
                   view: AnyView(ItemDetailView(drink: Fixtures.drinks[0], quantity: .constant(1)))),
        ScryScreen(id: "order", name: "Order", kind: "screen", title: ["Screens"],
                   file: "Kettle/Screens/OrderView.swift", line: 3,
                   view: AnyView(OrderView(order: Fixtures.order))),
        ScryScreen(id: "button", name: "Button", kind: "component", title: ["Components"],
                   file: "Kettle/Components/KettleButton.swift", line: 3,
                   view: AnyView(ComponentCanvas {
                       KettleButton(title: "Add to order")
                       KettleButton(title: "Add more", style: .secondary)
                   })),
        ScryScreen(id: "quantity-stepper", name: "QuantityStepper", kind: "component", title: ["Components"],
                   file: "Kettle/Components/QuantityStepper.swift", line: 3,
                   view: AnyView(ComponentCanvas { QuantityStepper(count: .constant(1)) })),
    ]
}

/// Centres a component on the app background so the screenshot shows it on its own.
struct ComponentCanvas<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(spacing: 16) { content() }
            .padding(.horizontal, 20)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Tokens.bg.ignoresSafeArea())
    }
}
#endif
