// ScryScreens.kt (debug source set only) - the registry. One entry per screen or component mapped in Scry.
// `id` is the stable identity across builds: never derive it from a title a human may edit.
// `file` and `line` point at the composable's source; they appear in Scry next to the capture.
package com.scrymore.kettle

import com.scrymore.kettle.ui.At
import com.scrymore.kettle.ui.ButtonVariant
import com.scrymore.kettle.ui.ItemDetailScreen
import com.scrymore.kettle.ui.KettleButton
import com.scrymore.kettle.ui.MenuScreen
import com.scrymore.kettle.ui.OrderScreen
import com.scrymore.kettle.ui.QuantityStepper

object ScryScreens {
    private const val UI = "app/src/main/java/com/scrymore/kettle/ui"

    val all: List<ScryScreen> = listOf(
        ScryScreen("screens-menu", "Menu", "$UI/MenuScreen.kt", 14) { MenuScreen() },
        ScryScreen("screens-item-detail", "Item Detail", "$UI/ItemDetailScreen.kt", 28) { ItemDetailScreen() },
        ScryScreen("screens-order", "Order", "$UI/OrderScreen.kt", 26) { OrderScreen() },
        ScryScreen("components-button", "Button", "$UI/Button.kt", 24) {
            At(56) { KettleButton("Add to order", ButtonVariant.Primary) }
        },
        ScryScreen("components-quantity-stepper", "Quantity Stepper", "$UI/QuantityStepper.kt", 24) {
            At(56) { QuantityStepper(count = 1) }
        },
    )
}
